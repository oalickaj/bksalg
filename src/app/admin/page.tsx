import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/admin-auth";
import { loadAdminData, parseFilters } from "@/lib/admin-data";
import { getCapacity, STATUS_LABEL, type DbStatus } from "@/lib/registrations";
import { formatOsloTime, formatOsloTimestamp } from "@/lib/time";
import { logoutAction, releaseAction, setPaidAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Alle statuser" },
  { value: "plass", label: "Plass" },
  { value: "ubetalt", label: "Plass – ikke betalt" },
  { value: "venteliste", label: "Venteliste" },
  { value: "frigitt", label: "Frigitt" },
];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const flash = typeof sp.melding === "string" ? sp.melding : null;
  const [{ rows, total, stats, classes }, capacity] = await Promise.all([loadAdminData(filters), getCapacity()]);

  const returnQuery = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="wide-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Påmeldinger</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="button secondary small" href={`/admin${returnQuery ? `?${returnQuery}` : ""}`}>
            Oppdater
          </Link>
          <a className="button small" href={`/admin/eksport${returnQuery ? `?${returnQuery}` : ""}`}>
            Eksporter CSV
          </a>
          <form action={logoutAction}>
            <button className="secondary small" type="submit">
              Logg ut
            </button>
          </form>
        </div>
      </div>

      <div className="stats">
        <Stat num={`${stats.plass} / ${capacity}`} label="Plasser tatt" />
        <Stat num={`${stats.betalt}`} label="Betalt" />
        <Stat num={`${stats.venteliste}`} label="På venteliste" />
        <Stat num={`${stats.overdue}`} label="Over betalingsfrist" />
      </div>

      {flash && <p className="flash">{flash}</p>}

      <form className="filters" method="get">
        <input name="q" placeholder="Søk på navn, epost eller mobil" defaultValue={filters.q} aria-label="Søk" />
        <select name="klasse" defaultValue={filters.klasse} aria-label="Klasse">
          <option value="">Alle klasser</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status} aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="small" style={{ minHeight: 46 }}>
          Filtrer
        </button>
      </form>

      <p className="muted small">
        Viser {rows.length} av {total}.{" "}
        {(filters.q || filters.klasse || filters.status) && <Link href="/admin">Nullstill filter</Link>}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Påmeldt</th>
              <th>Navn</th>
              <th>Klasse</th>
              <th>Mobil</th>
              <th>Epost</th>
              <th>Status</th>
              <th>Betalt</th>
              <th>Frist</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.queue_seq}</td>
                <td>{formatOsloTimestamp(r.created_at)}</td>
                <td>{r.full_name}</td>
                <td>{r.class_name}</td>
                <td>{r.phone}</td>
                <td>{r.email}</td>
                <td>
                  <Badge status={r.status} />
                  {r.waitlistPosition && <span className="muted"> nr. {r.waitlistPosition}</span>}
                  {r.promoted && r.status === "plass" && <span className="muted"> (opprykk)</span>}
                </td>
                <td>{r.paid ? "Ja" : "Nei"}</td>
                <td className={r.overdue ? "overdue" : ""}>
                  {r.deadline && !r.paid ? `${formatOsloTime(r.deadline)}${r.overdue ? " – passert" : ""}` : ""}
                </td>
                <td className="actions">
                  {r.status === "plass" && (
                    <form action={setPaidAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="paid" value={r.paid ? "false" : "true"} />
                      <input type="hidden" name="returnQuery" value={returnQuery} />
                      <SubmitButton
                        className={r.paid ? "secondary small" : "small"}
                        confirmText={r.paid ? `Fjerne betalingen for ${r.full_name}?` : undefined}
                      >
                        {r.paid ? "Angre betalt" : "Marker betalt"}
                      </SubmitButton>
                    </form>
                  )}
                  {(r.status === "plass" || r.status === "venteliste") && !r.paid && (
                    <form action={releaseAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="returnQuery" value={returnQuery} />
                      <SubmitButton
                        className="danger small"
                        confirmText={
                          r.status === "plass"
                            ? `Frigi plassen til ${r.full_name}? Første på ventelisten rykker opp og får epost. Dette kan ikke angres.`
                            : `Fjerne ${r.full_name} fra ventelisten? Dette kan ikke angres.`
                        }
                      >
                        {r.status === "plass" ? "Frigi plass" : "Fjern"}
                      </SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  Ingen påmeldinger her.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div className="stat">
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function Badge({ status }: { status: DbStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}
