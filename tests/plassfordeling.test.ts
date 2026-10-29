// Tester plassfordelingen mot en ekte Postgres med samme SQL som i
// produksjon. 1000 samtidige påmeldinger sendes over 100 parallelle
// databasetilkoblinger.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeStudents, shuffle, startTestDb, type TestDb } from "./db";

const CAPACITY = 250;
const STUDENTS = 1000;

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb(100);
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.pool.query("truncate registrations, rate_limits");
  await db.pool.query("update app_config set capacity = $1", [CAPACITY]);
});

type RegisterRow = {
  result: string;
  id: string;
  status: string;
  queue_seq: string;
  waitlist_position: number | null;
  full_name: string;
  matched_on: string | null;
  existing_status: string | null;
};

async function register(s: { fullName: string; className: string; phone: string; email: string }): Promise<RegisterRow> {
  const { rows } = await db.pool.query(
    "select * from register_student($1, $2, $3, $4, $5)",
    [s.fullName, s.className, s.phone, s.email, "1.2.3.4"],
  );
  return rows[0];
}

async function countByStatus(): Promise<Record<string, number>> {
  const { rows } = await db.pool.query(
    "select status, count(*)::int as n from registrations group by status",
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

describe("plassfordeling", () => {
  it(
    "1000 samtidige påmeldinger gir nøyaktig 250 plasser og 750 på venteliste i riktig rekkefølge",
    async () => {
      const students = makeStudents(STUDENTS);

      // Alle 1000 fyres av samtidig, i tilfeldig rekkefølge.
      const results = await Promise.all(shuffle(students).map((s) => register(s)));

      expect(results.every((r) => r.result === "ny")).toBe(true);
      expect(results.filter((r) => r.status === "plass")).toHaveLength(CAPACITY);
      expect(results.filter((r) => r.status === "venteliste")).toHaveLength(STUDENTS - CAPACITY);

      const counts = await countByStatus();
      expect(counts).toEqual({ plass: CAPACITY, venteliste: STUDENTS - CAPACITY });

      const { rows } = await db.pool.query(`
        select id, status, created_at, queue_seq::int as seq,
               waitlist_position(queue_seq) as pos
          from registrations
         order by queue_seq`);
      expect(rows).toHaveLength(STUDENTS);

      // De 250 første i rekkefølgen har plass, alle etter står på venteliste.
      rows.forEach((r, i) => {
        expect(r.status).toBe(i < CAPACITY ? "plass" : "venteliste");
      });

      // Tidspunktene (servertid) stiger i samme rekkefølge som plassene ble delt ut.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].created_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].created_at.getTime());
        expect(rows[i].seq).toBeGreaterThan(rows[i - 1].seq);
      }
      const lastPlass = rows[CAPACITY - 1].created_at.getTime();
      const firstWait = rows[CAPACITY].created_at.getTime();
      expect(lastPlass).toBeLessThanOrEqual(firstWait);

      // Ventelisten er nummerert 1..750 uten hull, i påmeldingsrekkefølge.
      const waitlist = rows.slice(CAPACITY);
      waitlist.forEach((r, i) => expect(r.pos).toBe(i + 1));

      // Plassnummeret eleven fikk vist i svaret stemmer med databasen.
      const posById = new Map(waitlist.map((r) => [r.id, r.pos]));
      for (const r of results.filter((x) => x.status === "venteliste")) {
        expect(r.waitlist_position).toBe(posById.get(r.id));
      }
    },
    120_000,
  );

  it("frigitt plass går til første på ventelisten", async () => {
    await db.pool.query("update app_config set capacity = 3");
    const students = makeStudents(6);
    for (const s of students) await register(s); // sekvensielt: 0,1,2 plass – 3,4,5 venteliste

    const { rows: before } = await db.pool.query(
      "select id, email, status from registrations order by queue_seq",
    );
    const { rows: released } = await db.pool.query("select * from release_spot($1)", [before[1].id]);

    expect(released.map((r) => r.result)).toEqual(["frigitt", "opprykk"]);
    expect(released[1].id).toBe(before[3].id);
    expect(released[1].email).toBe(before[3].email);

    const { rows: after } = await db.pool.query(
      "select id, status, promoted, waitlist_position(queue_seq) as pos from registrations order by queue_seq",
    );
    expect(after.map((r) => r.status)).toEqual(["plass", "frigitt", "plass", "plass", "venteliste", "venteliste"]);
    expect(after[3].promoted).toBe(true);
    expect(after[4].pos).toBe(1);
    expect(after[5].pos).toBe(2);
  });

  it("betalt plass kan ikke frigis", async () => {
    const r = await register(makeStudents(1)[0]);
    await db.pool.query("update registrations set paid = true where id = $1", [r.id]);
    const { rows } = await db.pool.query("select * from release_spot($1)", [r.id]);
    expect(rows[0].result).toBe("betalt");
    expect(await countByStatus()).toEqual({ plass: 1 });
  });

  it("samtidige frigivelser og nye påmeldinger deler aldri ut mer enn kapasiteten", async () => {
    const first = makeStudents(400);
    await Promise.all(shuffle(first).map((s) => register(s)));

    const { rows: plass } = await db.pool.query(
      "select id from registrations where status = 'plass' order by random() limit 30",
    );
    const more = makeStudents(300, 400);

    // 30 frigivelser og 300 nye påmeldinger blandet, samtidig.
    const jobs = shuffle<() => Promise<unknown>>([
      ...plass.map((p) => () => db.pool.query("select * from release_spot($1)", [p.id])),
      ...more.map((s) => () => register(s)),
    ]);
    await Promise.all(jobs.map((j) => j()));

    const counts = await countByStatus();
    expect(counts.plass).toBe(CAPACITY);
    expect(counts.frigitt).toBe(30);
    expect(counts.venteliste).toBe(700 - CAPACITY - 30);

    // Alle på ventelisten ble registrert senere enn alle som fikk plass uten opprykk.
    const { rows } = await db.pool.query(`
      select
        (select max(queue_seq) from registrations where status = 'plass' and not promoted) as last_direct,
        (select min(queue_seq) from registrations where status = 'venteliste') as first_wait,
        (select max(queue_seq) from registrations where promoted) as last_promoted`);
    expect(Number(rows[0].last_direct)).toBeLessThan(Number(rows[0].first_wait));
    expect(Number(rows[0].last_promoted)).toBeLessThan(Number(rows[0].first_wait));
  }, 60_000);
});

describe("påmelding og juksesikring", () => {
  it("samme epost eller mobil kan bare melde seg på én gang", async () => {
    expect((await register({ fullName: "Kari Nordmann", className: "2STB", phone: "91111111", email: "kari@skole.example.no" })).result).toBe("ny");

    const sameEmail = await register({ fullName: "Kari Nordmann", className: "2STB", phone: "92222222", email: "kari@skole.example.no" });
    expect(sameEmail).toMatchObject({ result: "duplikat", matched_on: "epost", existing_status: "plass" });

    const samePhone = await register({ fullName: "Annen Elev", className: "2STB", phone: "91111111", email: "annen@skole.example.no" });
    expect(samePhone).toMatchObject({ result: "duplikat", matched_on: "mobil" });

    const { rows } = await db.pool.query("select count(*)::int as n from registrations");
    expect(rows[0].n).toBe(1);
  });

  it("databasen avviser duplikater selv uten funksjonen (unik constraint)", async () => {
    await register({ fullName: "Kari Nordmann", className: "2STB", phone: "91111111", email: "kari@skole.example.no" });
    await expect(
      db.pool.query(
        `insert into registrations (full_name, class_name, phone, email, status, queue_seq)
         values ('X Y', '1A', '91111111', 'x@skole.example.no', 'venteliste', nextval('registration_seq'))`,
      ),
    ).rejects.toThrow(/registrations_phone_key/);
    await expect(
      db.pool.query(
        `insert into registrations (full_name, class_name, phone, email, status, queue_seq)
         values ('X Y', '1A', '93333333', 'KARI@skole.example.no', 'venteliste', nextval('registration_seq'))`,
      ),
    ).rejects.toThrow(/check/); // ikke-normalisert epost avvises
  });

  it("50 samtidige påmeldinger med samme epost gir bare én rad", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        register({ fullName: "Kari Nordmann", className: "2STB", phone: String(91000000 + i), email: "kari@skole.example.no" }),
      ),
    );
    expect(results.filter((r) => r.result === "ny")).toHaveLength(1);
    const { rows } = await db.pool.query("select count(*)::int as n from registrations");
    expect(rows[0].n).toBe(1);
  });

  it("find_status gir status for en registrert epost og ingenting for en ukjent", async () => {
    const student = { fullName: "Kari Nordmann", className: "2STB", phone: "91111111", email: "kari@skole.example.no" };
    await register(student);

    const { rows: found } = await db.pool.query("select * from find_status($1)", [student.email]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ full_name: "Kari Nordmann", status: "plass", paid: false });

    const { rows: missing } = await db.pool.query("select * from find_status($1)", ["ukjent@skole.example.no"]);
    expect(missing).toHaveLength(0);
  });

  it("rate limit slipper gjennom maks antall forsøk per vindu", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.pool.query("select hit_rate_limit('ip:1.2.3.4', 60, 5) as ok").then((r) => r.rows[0].ok),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("anon-rollen har ikke tilgang til tabellen eller funksjonene", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("set role anon");
      await expect(client.query("select * from registrations")).rejects.toThrow(/permission denied/);
      await expect(client.query("select * from register_student('A B', '1A', '91234567', 'a@skole.example.no', '1.2.3.4')")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.query("reset role");
      client.release();
    }
  });
});
