import { getConfig } from "@/lib/config";
import { StatusForm } from "./StatusForm";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const cfg = getConfig();
  return (
    <>
      <p className="eyebrow">{cfg.EVENT_NAME}</p>
      <h1>Sjekk status</h1>
      <p className="lead">Skriv inn skoleeposten du meldte deg på med, for å se om du har plass eller står på venteliste.</p>
      <StatusForm ticketPrice={cfg.TICKET_PRICE} vippsNumber={cfg.VIPPS_NUMBER} />
    </>
  );
}
