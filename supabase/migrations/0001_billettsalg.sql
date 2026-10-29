-- =====================================================================
-- Billettsalg: tabeller og funksjoner
-- Kjør hele filen i Supabase SQL Editor (eller med `supabase db push`).
--
-- Påmelding er ETT steg: eleven fyller ut skjemaet, og plassen avgjøres
-- med én gang av servertidspunktet (ingen bekreftelseslenke i epost).
-- =====================================================================

create type registration_status as enum (
  'plass',       -- har fått en av plassene
  'venteliste',  -- alle plassene var tatt da eleven meldte seg på
  'frigitt'      -- plassen (eller ventelisteplassen) ble frigitt av admin
);

-- Én rad med innstillinger. Antall plasser kan endres her uten ny deploy.
create table app_config (
  id        int primary key default 1 check (id = 1),
  capacity  int not null default 250 check (capacity >= 0)
);
insert into app_config (id, capacity) values (1, 250);

-- Løpenummer som deles ut i nøyaktig samme rekkefølge som påmeldingene
-- (tie-breaker hvis to tidspunkt skulle være like).
create sequence registration_seq;

-- ---------------------------------------------------------------------
-- Påmeldinger
-- ---------------------------------------------------------------------
create table registrations (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  full_name         text not null check (char_length(full_name) between 2 and 100),
  class_name        text not null check (char_length(class_name) between 1 and 20),
  -- Normalisert: kun siffer (8 siffer, uten +47)
  phone             text not null check (phone ~ '^[0-9]{8}$'),
  -- Normalisert: små bokstaver, uten mellomrom rundt
  email             text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  status            registration_status not null,
  -- Rekkefølgen plassen ble delt ut i (tildelt atomisk under lås).
  queue_seq         bigint not null unique,
  -- Når eleven fikk plass (ved innsending eller senere opprykk). Betalingsfristen regnes herfra.
  spot_granted_at   timestamptz,
  promoted          boolean not null default false,
  paid              boolean not null default false,
  paid_at           timestamptz,
  released_at       timestamptz,
  ip                text,

  constraint registrations_email_key unique (email),
  constraint registrations_phone_key unique (phone)
);

create index registrations_status_seq_idx on registrations (status, queue_seq);

-- Rate limiting (fast vindu) – fungerer på tvers av alle Vercel-instanser.
create table rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------
-- Sikkerhet: ingen tilgang for anon/authenticated. Alt går via
-- service role-nøkkelen på serveren (som omgår RLS).
-- ---------------------------------------------------------------------
alter table app_config    enable row level security;
alter table registrations enable row level security;
alter table rate_limits   enable row level security;

-- ---------------------------------------------------------------------
-- register_student: ATOMISK påmelding OG plassfordeling i ett steg.
--
-- pg_advisory_xact_lock gjør at bare én påmelding om gangen kan telle og
-- dele ut plasser. Låsen holdes til transaksjonen er ferdig, og neste
-- påmelding ser derfor alltid resultatet av den forrige. Det kan dermed
-- aldri deles ut flere plasser enn capacity, uansett hvor mange som
-- trykker samtidig. Tidspunktet settes med clock_timestamp() INNE i
-- låsen, og avgjør rekkefølgen.
--
--   result = 'ny'       → påmeldt, status/queue_seq i resten av raden
--            'duplikat' → epost eller mobil er allerede registrert
-- ---------------------------------------------------------------------
create or replace function register_student(
  p_full_name  text,
  p_class_name text,
  p_phone      text,
  p_email      text,
  p_ip         text
)
returns table (
  result            text,
  id                uuid,
  status            registration_status,
  queue_seq         bigint,
  waitlist_position int,
  full_name         text,
  class_name        text,
  email             text,
  spot_granted_at   timestamptz,
  matched_on        text,
  existing_status   registration_status
)
language plpgsql
set search_path = public
as $$
declare
  r          registrations%rowtype;
  v_capacity int;
  v_taken    int;
  v_now      timestamptz;
  v_seq      bigint;
  v_status   registration_status;
begin
  perform pg_advisory_xact_lock(724501);

  begin
    v_now := clock_timestamp();
    select c.capacity into v_capacity from app_config c where c.id = 1;
    select count(*) into v_taken from registrations x where x.status = 'plass';
    v_status := case when v_taken < v_capacity then 'plass'::registration_status else 'venteliste'::registration_status end;
    v_seq := nextval('registration_seq');

    insert into registrations (full_name, class_name, phone, email, status, queue_seq, spot_granted_at, ip, created_at)
    values (
      p_full_name, p_class_name, p_phone, p_email, v_status, v_seq,
      case when v_status = 'plass' then v_now end,
      p_ip, v_now
    )
    returning * into r;

    return query select
      'ny'::text, r.id, r.status, r.queue_seq,
      case when r.status = 'venteliste' then waitlist_position(r.queue_seq) end,
      r.full_name, r.class_name, r.email, r.spot_granted_at,
      null::text, null::registration_status;
  exception when unique_violation then
    return query
      select
        'duplikat'::text, null::uuid, null::registration_status, null::bigint, null::int,
        null::text, null::text, null::text, null::timestamptz,
        case when x.email = p_email then 'epost' else 'mobil' end,
        x.status
      from registrations x
      where x.email = p_email or x.phone = p_phone
      order by (x.email = p_email) desc
      limit 1;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- waitlist_position: plassnummer på ventelisten (1 = først i køen)
-- ---------------------------------------------------------------------
create or replace function waitlist_position(p_queue_seq bigint)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
    from registrations
   where status = 'venteliste'
     and queue_seq <= p_queue_seq;
$$;

-- ---------------------------------------------------------------------
-- find_status: oppslag av egen status med epost (for eleven, uten at
-- det trengs noen epost med lenke). Returnerer ingenting hvis eposten
-- ikke finnes – det er med vilje, slik at man ikke kan sjekke om en
-- epost er registrert via denne funksjonen.
-- ---------------------------------------------------------------------
create or replace function find_status(p_email text)
returns table (
  full_name       text,
  class_name      text,
  status          registration_status,
  waitlist_position int,
  spot_granted_at timestamptz,
  paid            boolean
)
language sql
stable
set search_path = public
as $$
  select
    r.full_name, r.class_name, r.status,
    case when r.status = 'venteliste' then waitlist_position(r.queue_seq) end,
    r.spot_granted_at, r.paid
  from registrations r
  where r.email = p_email;
$$;

-- ---------------------------------------------------------------------
-- release_spot: frigir en plass (eller ventelisteplass) og lar de
-- første på ventelisten rykke opp så lenge det er ledige plasser.
-- Bruker samme lås som register_student.
--   Første rad: result = 'frigitt' | 'ikke_funnet' | 'betalt' | 'ugyldig_status'
--   Eventuelle neste rader: result = 'opprykk' med info om den som rykket opp
-- ---------------------------------------------------------------------
create or replace function release_spot(p_id uuid)
returns table (
  result          text,
  id              uuid,
  full_name       text,
  class_name      text,
  email           text,
  spot_granted_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  r          registrations%rowtype;
  w          registrations%rowtype;
  v_capacity int;
  v_taken    int;
  v_now      timestamptz;
begin
  perform pg_advisory_xact_lock(724501);

  select * into r from registrations x where x.id = p_id for update;
  if not found then
    return query select 'ikke_funnet'::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if r.paid then
    return query select 'betalt'::text, r.id, r.full_name, r.class_name, r.email, r.spot_granted_at;
    return;
  end if;
  if r.status not in ('plass', 'venteliste') then
    return query select 'ugyldig_status'::text, r.id, r.full_name, r.class_name, r.email, r.spot_granted_at;
    return;
  end if;

  v_now := clock_timestamp();
  update registrations x set status = 'frigitt', released_at = v_now where x.id = r.id;
  return query select 'frigitt'::text, r.id, r.full_name, r.class_name, r.email, r.spot_granted_at;

  select c.capacity into v_capacity from app_config c where c.id = 1;
  loop
    select count(*) into v_taken from registrations x where x.status = 'plass';
    exit when v_taken >= v_capacity;

    select * into w from registrations x
     where x.status = 'venteliste'
     order by x.queue_seq
     limit 1
     for update;
    exit when not found;

    update registrations x
       set status = 'plass', spot_granted_at = clock_timestamp(), promoted = true
     where x.id = w.id
    returning * into w;

    return query select 'opprykk'::text, w.id, w.full_name, w.class_name, w.email, w.spot_granted_at;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- hit_rate_limit: teller et forsøk og svarer true hvis det er innenfor
-- grensen (p_max forsøk per p_window_seconds).
-- ---------------------------------------------------------------------
create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits as rl (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;

  if random() < 0.01 then
    delete from rate_limits where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_count <= p_max;
end;
$$;

-- ---------------------------------------------------------------------
-- Rettigheter: kun service_role kan bruke funksjonene og tabellene.
-- ---------------------------------------------------------------------
revoke all on table app_config, registrations, rate_limits from public;
revoke all on sequence registration_seq from public;
revoke all on function register_student(text, text, text, text, text) from public;
revoke all on function waitlist_position(bigint) from public;
revoke all on function find_status(text) from public;
revoke all on function release_spot(uuid) from public;
revoke all on function hit_rate_limit(text, int, int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table app_config, registrations, rate_limits from anon, authenticated';
    execute 'revoke all on sequence registration_seq from anon, authenticated';
    execute 'revoke all on function register_student(text, text, text, text, text) from anon, authenticated';
    execute 'revoke all on function waitlist_position(bigint) from anon, authenticated';
    execute 'revoke all on function find_status(text) from anon, authenticated';
    execute 'revoke all on function release_spot(uuid) from anon, authenticated';
    execute 'revoke all on function hit_rate_limit(text, int, int) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table app_config, registrations, rate_limits to service_role';
    execute 'grant usage, select on sequence registration_seq to service_role';
    execute 'grant execute on function register_student(text, text, text, text, text) to service_role';
    execute 'grant execute on function waitlist_position(bigint) to service_role';
    execute 'grant execute on function find_status(text) to service_role';
    execute 'grant execute on function release_spot(uuid) to service_role';
    execute 'grant execute on function hit_rate_limit(text, int, int) to service_role';
  end if;
end;
$$;
