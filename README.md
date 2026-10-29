# Billettsalg – påmeldingssystem

Påmelding med begrenset antall plasser (250), venteliste og oversikt over manuell Vipps-betaling.
Bygget med Next.js (App Router, TypeScript), Supabase (Postgres) og Brevo (transaksjonsepost, gratis).

## Slik fungerer det

1. Eleven fyller ut navn, klasse, mobil og skoleepost og trykker **«Meld meg på»**.
2. **Plassen avgjøres med én gang**, atomisk i databasen, av servertidspunktet eleven trykker: de 250 første
   får **plass**, resten havner på **venteliste** med plassnummer. Det er ingen bekreftelseslenke i epost –
   innsendingen *er* påmeldingen.
3. Eleven ser resultatet direkte på siden. Får eleven plass, kommer Vipps-informasjon med én gang, og en epost
   sendes som sikkerhetskopi. Står eleven på venteliste, vises bare plassnummeret (det er ikke noe å betale før
   man eventuelt rykker opp, så ingen epost sendes da).
4. Elever kan sjekke status senere på `/status` ved å skrive inn skoleeposten sin.
5. I `/admin` markerer arrangøren betalinger og frigir plasser som ikke blir betalt. Første på ventelisten rykker
   da opp automatisk og får epost med ny betalingsfrist.

> **Hvorfor ingen bekreftelseslenke?** Et system med lenke i epost krever at man sender én epost per elev i
> samme sekund salget åpner – opp mot 1000 eposter på et par minutter. Det krever en betalt epostplan.
> Ved å avgjøre plassen direkte ved innsending, og bare sende epost til de som faktisk får plass med én gang
> (maks 250 av gangen), holder vi oss trygt innenfor gratisplanen hos Brevo (300/dag).
>
> Avveiningen: systemet bekrefter ikke at eleven *eier* innboksen til skoleeposten før plassen gis – bare at
> adressen har riktig domeneformat. Noen kan i prinsippet skrive inn en epost de ikke har tilgang til selv.
> Admin-oversikten og CSV-eksporten gjør det enkelt å fange opp og rette feil manuelt i etterkant om det skjer.

### Juksesikring

| Tiltak | Hvor |
|---|---|
| Én påmelding per skoleepost (små bokstaver, trimmet) | Unik constraint i databasen |
| Én påmelding per mobilnummer (kun siffer, `+47` fjernes) | Unik constraint i databasen |
| Kun tillatt epostdomene, og `+`-adresser avvises (`ola+1@…` går til samme innboks) | zod i nettleser **og** server |
| Plassfordeling med lås – aldri mer enn 250 plasser | Postgres-funksjonen `register_student` |
| Rate limiting per IP og per statusoppslag | Postgres-tabellen `rate_limits` (virker på tvers av Vercel-instanser) |
| Salget åpner/stenger etter tidspunkt | Sjekkes på serveren, ikke bare i nettleseren |
| Skjemaet sier ikke *hvilket* felt som var i bruk ved duplikat, og `/status` sier ingenting om en epost ikke finnes | `src/app/actions.ts`, `find_status()` |
| Service role-nøkkelen finnes kun på serveren | `src/lib/supabase.ts` med `server-only` |
| Skjult felt mot roboter | Påmeldingsskjemaet |

---

## Oppsett steg for steg

### 1. Opprett Supabase-prosjekt

1. Gå til [supabase.com](https://supabase.com) og lag en gratis konto.
2. Velg **New project**. Velg region **Stockholm (eu-north-1)**, nærmest Norge, og et sterkt databasepassord.
3. Vent til prosjektet er klart (et par minutter).

### 2. Kjør SQL-en

1. Åpne **SQL Editor** i Supabase og velg **New query**.
2. Lim inn hele innholdet i `supabase/migrations/0001_billettsalg.sql` og trykk **Run**.
3. Sjekk under **Table Editor** at tabellene `registrations`, `app_config` og `rate_limits` finnes.

Antall plasser ligger i databasen og kan endres uten ny deploy:

```sql
update app_config set capacity = 250;
```

### 3. Hent Supabase-nøklene

Gå til **Project Settings → API** (eller **API Keys**):

- **Project URL** → `SUPABASE_URL`
- **service_role**-nøkkelen (eller en ny **secret key** `sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`

⚠️ Nøkkelen gir full tilgang til databasen. Den skal bare ligge i miljøvariabler på serveren, aldri i kode,
aldri i en variabel som starter med `NEXT_PUBLIC_`, og aldri i Git. Appen bruker ikke anon-nøkkelen i det hele tatt.

### 4. Sett opp Brevo (epost, gratis)

Brevo har en gratisplan på **300 eposter per dag, for alltid, uten kredittkort**. Siden systemet bare sender
epost til de som får plass med én gang (maks `capacity`, normalt 250), holder gratisplanen trygt – så lenge
`capacity` ikke settes høyere enn ca. 290.

1. Lag en konto på [brevo.com](https://www.brevo.com) (gratis, ingen kort).
2. **Senders & IPs → Senders**: legg til og verifiser avsenderadressen du vil sende fra. Enklest er å verifisere
   én epostadresse (f.eks. `din-epost@gmail.com`); vil du sende fra et eget domene (f.eks. `billett@skolen.no`),
   kan du i stedet verifisere domenet med DNS-poster for bedre leveringsgrad.
3. **Settings (tannhjulet) → SMTP & API → API Keys → Generate a new API key** → `BREVO_API_KEY`.
4. Sett `EMAIL_FROM` til den verifiserte adressen, og `EMAIL_FROM_NAME` til et visningsnavn, f.eks. `Billettsalg`.

> Brevo har også en grense på eposter **per sekund**. Ved stor pågang (mange får plass samtidig helt i starten)
> prøver systemet på nytt i opptil 20 sekunder. Test gjerne med noen titalls samtidige påmeldinger før salget
> for å se at det går greit (se sjekklisten nederst).

### 5. Sett miljøvariabler

Kopier `.env.example` til `.env.local` for lokal utvikling og fyll inn verdiene:

| Variabel | Påkrevd | Forklaring |
|---|---|---|
| `SUPABASE_URL` | ja | Prosjekt-URL fra Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ja | Hemmelig nøkkel, kun server |
| `BREVO_API_KEY` | ja | API-nøkkel fra Brevo |
| `EMAIL_FROM` | ja | Verifisert avsenderadresse i Brevo |
| `EMAIL_FROM_NAME` | nei | Visningsnavn på avsender. Standard «Billettsalg» |
| `ALLOWED_EMAIL_DOMAIN` | ja | F.eks. `skole.example.no`. Bare dette domenet godtas, ikke underdomener. Flere kan skilles med komma. |
| `VIPPS_NUMBER` | ja | Vipps-nummeret elevene betaler til |
| `SALES_OPEN_AT` | ja | F.eks. `2026-11-05T12:00`. Uten tidssone tolkes det som norsk tid (Europe/Oslo). |
| `SALES_CLOSE_AT` | nei | Når salget stenger. Tom = aldri. |
| `ADMIN_PASSWORD` | ja | Passord til `/admin`, minst 12 tegn |
| `EVENT_NAME` | nei | Navn på arrangementet i overskrifter og eposter |
| `TICKET_PRICE` | nei | Standard `250` |
| `RATE_LIMIT_PER_IP` | nei | Maks påmeldinger per IP per vindu. Standard `60`. |
| `RATE_LIMIT_WINDOW_SECONDS` | nei | Standard `60` |

> **Om rate limiting og skolenettverket:** Alle elever på skolens wifi har ofte **samme IP-adresse** utad. Er
> grensen for lav, kan elever på skolen bli stoppet mens elever på mobildata kommer gjennom. Den egentlige
> sperren mot dobbeltpåmelding er de unike kravene til epost og mobil. IP-grensen stopper bare roboter og spam.
> Skal mange melde seg på fra skolens nett samtidig, bør du sette `RATE_LIMIT_PER_IP` til f.eks. `600`, eller
> be elevene bruke mobildata.

### 6. Kjør lokalt

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # kjører testene (starter en midlertidig Postgres automatisk)
```

### 7. Deploy til Vercel (gratis)

1. Legg koden i et GitHub-repo (sjekk at `.env.local` **ikke** blir med; den står i `.gitignore`).
2. Gå til [vercel.com](https://vercel.com) → **Add New → Project** → velg repoet. Vercel oppdager Next.js selv.
3. Under **Environment Variables**: legg inn alle variablene fra tabellen over.
4. Trykk **Deploy**.
5. Endrer du miljøvariabler senere (f.eks. `SALES_OPEN_AT`), må du ta en ny deploy (**Deployments → Redeploy**)
   for at endringen skal gjelde.

Merk:
- Gratisplanen i Supabase **setter prosjektet på pause etter en uke uten aktivitet**. Logg inn og sjekk at
  prosjektet er aktivt dagen før salget.
- Vercels gratisplan (Hobby) er ment for ikke-kommersiell bruk. Les vilkårene hvis skolen eller en forening
  står bak salget.

### 8. Nullstill etter testing

Når du har testet, tømmer du databasen før det ekte salget (SQL Editor):

```sql
truncate registrations, rate_limits;
alter sequence registration_seq restart;
```

---

## Admin

Gå til `/admin` og logg inn med `ADMIN_PASSWORD`. Innloggingen lagres i en httpOnly-cookie i 12 timer. Bytter du
passordet, blir alle innlogginger ugyldige.

- **Tellerne øverst** viser plasser tatt, betalt, venteliste og hvor mange som er over betalingsfristen.
- **Marker betalt** når du ser betalingen i Vipps (sjekk navn og klasse i meldingen).
- **Frigi plass** når fristen (kolonnen *Frist*, rød når den er passert) er ute og personen ikke har betalt.
  Første på ventelisten rykker opp og får epost med ny frist på 30 minutter. En betalt plass kan ikke frigis.
- **Fjern** tar noen ut av ventelisten.
- **Søk/filter** på navn, epost, mobil, klasse og status. Statusfilteret *Plass – ikke betalt* er nyttig når
  du går gjennom betalinger.
- **Eksporter CSV** gir en fil med kolonnene `navn, klasse, mobil, epost, status, betalt` (semikolon som
  skilletegn og UTF-8 med BOM, så æøå vises riktig i Excel og Google Sheets). Eksporten følger aktivt filter.

Statusene:

| Status | Betyr |
|---|---|
| Plass | Har fått plass, må betale innen 30 minutter fra registreringen (eller opprykket) |
| Venteliste | Meldte seg på etter at plassene var tatt |
| Frigitt | Plassen er frigitt av admin |

---

## Teknisk oversikt

```
supabase/migrations/0001_billettsalg.sql  Tabeller, constraints og Postgres-funksjonene
src/app/page.tsx                          Forside: nedtelling / skjema / stengt
src/app/actions.ts                        Påmelding (server action): salgstid, rate limit, zod, plassfordeling, epost
src/app/status/                           Statusoppslag med epost (ingen innlogging, bare lesing)
src/app/admin/                            Innlogging, oversikt, handlinger og CSV-eksport
src/lib/                                  Konfig, validering, epost, databasekall, admin-autentisering
tests/                                    Tester mot ekte Postgres + valideringstester
```

**Plassfordelingen** skjer i `register_student()`, som gjør hele påmeldingen i ett steg: validerer unikhet,
teller plassene og setter status og tidspunkt – alt i én transaksjon med en lås (`pg_advisory_xact_lock`).
Påmeldinger behandles dermed én og én i rekkefølge, og neste ser alltid resultatet av den forrige. Derfor kan
det aldri bli mer enn `capacity` plasser. `release_spot()` bruker samme lås, så frigivelser og nye påmeldinger
som skjer samtidig, ikke kan krasje med hverandre. Hver påmelding tar bare brøkdeler av et millisekund under
låsen, så 1000 samtidige går fint.

**Testene** (`npm test`) starter en ekte Postgres og kjører migrasjonen. Så sendes 1000 påmeldinger samtidig
over 100 parallelle tilkoblinger. Testene sjekker blant annet:
- at nøyaktig 250 får plass og 750 kommer på venteliste,
- at de 250 med plass er nøyaktig de 250 første i påmeldingsrekkefølgen,
- at ventelisten er nummerert 1–750 uten hull, og at tidspunktene stiger,
- at frigivelse med opprykk, betalte plasser, samtidige frigivelser og nye påmeldinger, duplikater, statusoppslag,
  rate limit og rettighetene for anon-rollen oppfører seg riktig.

---

## Sjekkliste: test manuelt før salget åpner

Gjør dette på den ekte Vercel-adressen med ekte Supabase og Brevo, **minst et par dager før**. Sett
`SALES_OPEN_AT` noen minutter frem i tid og redeploy.

**Epost**
- [ ] Eposten med Vipps-informasjon kommer frem raskt til en ekte **skoleepost** (ikke bare din private), og ikke
      i søppelpost.
- [ ] Opprykksepostene fra ventelisten ser riktige ut, med riktig Vipps-nummer, beløp og ny frist.
- [ ] Brevo-kontoen er satt opp og sender uten feil (sjekk **Transactional → Logs** i Brevo).

**Salgstid**
- [ ] Før `SALES_OPEN_AT` vises nedtelling med riktig dato og klokkeslett (norsk tid), og skjemaet vises ikke.
- [ ] Siden bytter selv til skjemaet når nedtellingen er ferdig.
- [ ] `SALES_CLOSE_AT` (hvis brukt) stenger påmeldingen.

**Påmelding**
- [ ] Gyldig påmelding viser med én gang «Du har fått plass!» eller plassnummer på venteliste.
- [ ] Feil domene, `+`-adresse, ugyldig mobil og bare fornavn gir tydelige feilmeldinger.
- [ ] Samme epost eller mobil to ganger gir meldingen «Du er allerede påmeldt».
- [ ] `/status` finner en registrert epost og viser riktig status, og sier «fant ingen påmelding» for en ukjent
      epost (uten å skille på om eposten finnes eller ikke før man har skrevet riktig domeneformat).

**Plasser**
- [ ] Sett `capacity` til 2 i `app_config`, og meld på 3–4 testpersoner. De to første får plass, resten
      kommer på venteliste med riktig nummer. (Sett tilbake til 250 etterpå!)
- [ ] Vipps-informasjonen (nummer, beløp, frist, «navn, klasse») er riktig både på skjermen og i eposten.

**Admin**
- [ ] `/admin` krever passord, og feil passord blir avvist. Etter 10 feil forsøk blir du sperret i 15 minutter.
- [ ] Tellerne stemmer med tabellen.
- [ ] *Marker betalt* og *Angre betalt* virker.
- [ ] *Frigi plass* på en ubetalt plass: første på ventelisten får *Plass (opprykk)* og en epost, og alle
      ventelistenumrene flytter seg én opp.
- [ ] Søk og filter på navn, klasse og status virker.
- [ ] CSV-filen åpnes riktig i Excel **og** Google Sheets, med æøå og riktige kolonner.
- [ ] Admin fungerer på mobilen du skal bruke under salget.

**Last og drift**
- [ ] Gjør en test med mange samtidige påmeldinger fra skolens wifi, og juster `RATE_LIMIT_PER_IP` om
      noen blir stoppet.
- [ ] Supabase-prosjektet er aktivt (ikke satt på pause) dagen før.
- [ ] Databasen er tømt for testdata (se steg 8), `capacity` er 250, og `SALES_OPEN_AT` er satt til riktig
      tidspunkt med en ny deploy.
- [ ] Noen er klar i admin når salget åpner, og elevene vet hvem de kan kontakte hvis noe går galt.
