import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { RegistrationForm } from "@/components/RegistrationForm";
import { getConfig, getSalesState } from "@/lib/config";
import { formatOsloDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const cfg = getConfig();
  const now = new Date();
  const state = getSalesState(now);

  return (
    <>
      <p className="eyebrow">{cfg.EVENT_NAME}</p>
      <h1>Påmelding</h1>
      <p className="lead">
        Billetten koster {cfg.TICKET_PRICE} kr og betales med Vipps. <strong>Plassen avgjøres av når du melder deg
        på</strong> – du ser med én gang om du fikk plass eller venteliste.
      </p>

      {state === "ikke_startet" && (
        <div className="card">
          <h2>Påmeldingen åpner {formatOsloDateTime(cfg.SALES_OPEN_AT)}</h2>
          <Countdown openAt={cfg.SALES_OPEN_AT.getTime()} serverNow={now.getTime()} />
          <p className="muted small">Siden oppdateres av seg selv når påmeldingen åpner.</p>
        </div>
      )}

      {state === "aapen" && (
        <RegistrationForm allowedDomains={cfg.ALLOWED_EMAIL_DOMAIN} ticketPrice={cfg.TICKET_PRICE} vippsNumber={cfg.VIPPS_NUMBER} />
      )}

      {state === "stengt" && (
        <div className="card warn">
          <h2>Påmeldingen er stengt</h2>
          <p>
            Det er ikke lenger mulig å melde seg på. Har du allerede meldt deg på, kan du{" "}
            <Link href="/status">sjekke status her</Link>.
          </p>
        </div>
      )}

      <div className="card info">
        <h2>Slik fungerer det</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Fyll ut skjemaet med skoleeposten din.</li>
          <li>Plassen avgjøres med én gang av tidspunktet du melder deg på.</li>
          <li>Plassene går til de første. Resten havner på venteliste.</li>
          <li>Får du plass, må du vippse {cfg.TICKET_PRICE} kr innen 30 minutter.</li>
        </ol>
      </div>
    </>
  );
}
