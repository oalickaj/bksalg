// Hjelpefunksjoner for testene: starter en ekte Postgres lokalt
// (embedded-postgres) og kjører migrasjonen fra supabase/migrations.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54000 + Math.floor(Math.random() * 1000);

export type TestDb = {
  pool: pg.Pool;
  stop: () => Promise<void>;
};

export async function startTestDb(poolSize = 100): Promise<TestDb> {
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), "billettsalg-pg-")),
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    postgresFlags: ["-c", "max_connections=250"],
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("billettsalg");

  const pool = new pg.Pool({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "billettsalg",
    max: poolSize,
  });
  pool.on("error", () => {}); // tilkoblinger som avsluttes når testserveren stoppes

  // Rollene finnes alltid i Supabase. Vi lager dem her for å teste at
  // rettighetene i migrasjonen fungerer.
  await pool.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(dir, file), "utf8"));
  }

  return {
    pool,
    stop: async () => {
      await pool.end();
      await server.stop();
    },
  };
}

/** Lager n unike elever (brukes som input til register_student). */
export function makeStudents(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const nr = offset + i;
    return {
      fullName: `Elev Nummer${nr}`,
      className: `${1 + (nr % 3)}ST${String.fromCharCode(65 + (nr % 5))}`,
      phone: String(90000000 + nr),
      email: `elev${nr}@skole.example.no`,
    };
  });
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
