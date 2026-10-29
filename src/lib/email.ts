import "server-only";
import { getConfig, PAYMENT_DEADLINE_MINUTES, type Config } from "./config";
import { formatOsloTime } from "./time";

// Brevo (tidligere Sendinblue) har en gratisplan på 300 eposter/dag, for
// alltid, uten kredittkort. Vi sender bare epost til de som får plass
// med én gang (maks «capacity», normalt 250) – det er alt som haster,
// siden Vipps-fristen løper fra det tidspunktet. Elever på venteliste ser
// plassnummeret sitt direkte på siden og kan sjekke status senere på
// /status, uten at det trengs noen epost. Så lenge capacity ikke er satt
// høyere enn ca. 290, er gratisplanen god margin på selve åpningsdagen.
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mail = { to: string; subject: string; html: string; text: string };

/**
 * Sender epost med nye forsøk ved pågang (Brevo har en grense på antall
 * kall per sekund). Prøver i opptil ca. 20 sekunder før den gir opp.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const cfg = getConfig();
  const deadline = Date.now() + 20_000;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          "api-key": cfg.BREVO_API_KEY,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: cfg.EMAIL_FROM, name: cfg.EMAIL_FROM_NAME },
          to: [{ email: mail.to }],
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
        }),
      });
      if (res.ok) return true;
      if (!RETRYABLE_STATUS.has(res.status) || Date.now() > deadline) {
        console.error("Epost feilet", res.status, await res.text().catch(() => ""));
        return false;
      }
    } catch (e) {
      if (Date.now() > deadline) {
        console.error("Epost feilet", e);
        return false;
      }
    }
    const backoff = Math.min(4000, 300 * 2 ** attempt);
    await sleep(backoff / 2 + Math.random() * backoff);
  }
}

// ---------------------------------------------------------------------
// Maler
// ---------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(cfg: Config, title: string, body: string): string {
  return `<!doctype html><html lang="nb"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 4px;font-size:13px;color:#6b7280">${esc(cfg.EVENT_NAME)}</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(title)}</h1>
${body}
</div></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${s}</p>`;
const box = (s: string) =>
  `<div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#f0f6ff;border:1px solid #c9dcff;font-size:16px;line-height:1.6">${s}</div>`;

function paymentInstructions(cfg: Config, name: string, className: string, deadline: Date) {
  const merk = `${name}, ${className}`;
  return {
    html: box(
      `<strong>Vipps ${cfg.TICKET_PRICE} kr til ${esc(cfg.VIPPS_NUMBER)}</strong><br>` +
        `innen <strong>kl. ${formatOsloTime(deadline)}</strong> (${PAYMENT_DEADLINE_MINUTES} minutter).<br>` +
        `Merk betalingen med: <strong>${esc(merk)}</strong>`,
    ),
    text: `Vipps ${cfg.TICKET_PRICE} kr til ${cfg.VIPPS_NUMBER} innen kl. ${formatOsloTime(deadline)} (${PAYMENT_DEADLINE_MINUTES} minutter).\nMerk betalingen med: ${merk}`,
  };
}

/** Sendes med én gang til de som får plass direkte, og til de som rykker opp fra ventelisten senere. */
export function spotMail(to: string, name: string, className: string, spotGrantedAt: Date, promoted: boolean): Mail {
  const cfg = getConfig();
  const deadline = new Date(spotGrantedAt.getTime() + PAYMENT_DEADLINE_MINUTES * 60_000);
  const pay = paymentInstructions(cfg, name, className, deadline);
  const title = promoted ? "Du har rykket opp fra ventelisten!" : "Du har fått plass!";
  const intro = promoted
    ? "En plass ble ledig, og du var neste på ventelisten. Plassen er din hvis du betaler innen fristen."
    : "Gratulerer, du fikk en av plassene. Plassen er ikke din før betalingen er registrert.";
  return {
    to,
    subject: `${title} – ${cfg.EVENT_NAME}`,
    html: layout(
      cfg,
      title,
      p(`Hei ${esc(name)}!`) +
        p(intro) +
        pay.html +
        p("Betaler du ikke innen fristen, kan plassen bli gitt videre til neste på ventelisten."),
    ),
    text: `Hei ${name}!\n\n${intro}\n\n${pay.text}\n\nBetaler du ikke innen fristen, kan plassen bli gitt videre til neste på ventelisten.`,
  };
}
