"use server";

import { getConfig, getSalesState } from "@/lib/config";
import { sendMail, spotMail } from "@/lib/email";
import { checkRateLimit, getClientIp, registerStudent, type DbStatus } from "@/lib/registrations";
import { createRegistrationSchema, type RegistrationField } from "@/lib/validation";

export type RegisterState =
  | { status: "idle" }
  | {
      status: "registered";
      dbStatus: DbStatus;
      fullName: string;
      className: string;
      waitlistPosition: number | null;
      spotGrantedAt: string | null;
    }
  | { status: "duplikat" }
  | { status: "error"; message?: string; fieldErrors?: Partial<Record<RegistrationField, string>>; values?: Record<string, string> };

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    className: String(formData.get("className") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
  };

  // Honningkrukke: skjult felt som bare roboter fyller ut.
  if (String(formData.get("hp_check") ?? "") !== "") {
    return { status: "duplikat" };
  }

  // Sjekkes på serveren – uansett hva nettleseren viser.
  const sales = getSalesState();
  if (sales === "ikke_startet") {
    return { status: "error", message: "Påmeldingen har ikke åpnet ennå. Last inn siden på nytt når nedtellingen er ferdig.", values };
  }
  if (sales === "stengt") {
    return { status: "error", message: "Påmeldingen er stengt.", values };
  }

  const cfg = getConfig();
  const ip = await getClientIp();
  if (!(await checkRateLimit(`pamelding:ip:${ip}`, cfg.RATE_LIMIT_PER_IP, cfg.RATE_LIMIT_WINDOW_SECONDS))) {
    return { status: "error", message: "Det har kommet for mange forsøk fra nettverket ditt. Vent ett minutt og prøv igjen.", values };
  }

  const parsed = createRegistrationSchema(cfg.ALLOWED_EMAIL_DOMAIN).safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<RegistrationField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as RegistrationField;
      fieldErrors[field] ??= issue.message;
    }
    return { status: "error", message: "Sjekk feltene som er markert.", fieldErrors, values };
  }
  const input = parsed.data;

  let result;
  try {
    result = await registerStudent({ ...input, ip });
  } catch (e) {
    console.error(e);
    return { status: "error", message: "Noe gikk galt hos oss. Prøv igjen om litt.", values };
  }

  if (result.result === "duplikat") {
    // Skjuler hvilket felt som var i bruk og hva status var – gir bare en
    // generell, men tydelig, melding om at eleven allerede er registrert.
    return { status: "duplikat" };
  }

  if (result.status === "plass" && result.spotGrantedAt) {
    // Dette haster (30 min betalingsfrist), så vi venter på at eposten er sendt.
    await sendMail(spotMail(result.email, result.fullName, result.className, new Date(result.spotGrantedAt), false));
  }
  // Venteliste får ikke epost med én gang – status vises direkte på siden,
  // og de kan sjekke den igjen senere på /status.

  return {
    status: "registered",
    dbStatus: result.status,
    fullName: result.fullName,
    className: result.className,
    waitlistPosition: result.waitlistPosition,
    spotGrantedAt: result.spotGrantedAt,
  };
}
