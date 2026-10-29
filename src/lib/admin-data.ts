import "server-only";
import { listAllRegistrations, paymentDeadline, type DbStatus, type Registration } from "./registrations";

export type AdminRow = Registration & {
  waitlistPosition: number | null;
  deadline: Date | null;
  overdue: boolean;
};

export type Filters = { q: string; klasse: string; status: string };

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return { q: one(sp.q).trim(), klasse: one(sp.klasse).trim(), status: one(sp.status).trim() };
}

const STATUS_ORDER: Record<DbStatus, number> = { plass: 0, venteliste: 1, frigitt: 2 };

export async function loadAdminData(filters: Filters) {
  const now = new Date();
  const all = await listAllRegistrations();

  const waitlist = all.filter((r) => r.status === "venteliste").sort((a, b) => a.queue_seq - b.queue_seq);
  const positions = new Map(waitlist.map((r, i) => [r.id, i + 1]));

  const rows: AdminRow[] = all.map((r) => {
    const deadline = r.status === "plass" && r.spot_granted_at ? paymentDeadline(r.spot_granted_at) : null;
    return {
      ...r,
      waitlistPosition: positions.get(r.id) ?? null,
      deadline,
      overdue: !!deadline && !r.paid && deadline < now,
    };
  });

  rows.sort((a, b) => a.queue_seq - b.queue_seq);

  const stats = {
    plass: rows.filter((r) => r.status === "plass").length,
    betalt: rows.filter((r) => r.status === "plass" && r.paid).length,
    venteliste: waitlist.length,
    overdue: rows.filter((r) => r.overdue).length,
  };

  const classes = [...new Set(rows.map((r) => r.class_name))].sort((a, b) => a.localeCompare(b, "nb", { numeric: true }));

  const q = filters.q.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!q || r.full_name.toLowerCase().includes(q) || r.email.includes(q) || r.phone.includes(q.replace(/\s/g, ""))) &&
      (!filters.klasse || r.class_name === filters.klasse.toUpperCase()) &&
      (!filters.status || (filters.status === "ubetalt" ? r.status === "plass" && !r.paid : r.status === filters.status)),
  );

  return { rows: filtered, total: rows.length, stats, classes };
}

export function sortForExport(rows: AdminRow[]): AdminRow[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
