"use server";

import { z } from "zod";
import { checkRateLimit, findStatus, getClientIp, paymentDeadline, type DbStatus } from "@/lib/registrations";
import { normalizeEmail } from "@/lib/validation";

export type StatusState =
  | { status: "idle" }
  | { status: "ikke_funnet" }
  | { status: "error"; message: string }
  | {
      status: "funnet";
      fullName: string;
      className: string;
      dbStatus: DbStatus;
      waitlistPosition: number | null;
      paid: boolean;
      deadline: string | null;
    };

export async function lookupStatusAction(_prev: StatusState, formData: FormData): Promise<StatusState> {
  const email = normalizeEmail(z.string().safeParse(formData.get("email")).data ?? "");
  const ip = await getClientIp();

  if (!(await checkRateLimit(`status:ip:${ip}`, 30, 60))) {
    return { status: "error", message: "For mange forsøk. Vent litt og prøv igjen." };
  }
  if (!email.includes("@")) {
    return { status: "error", message: "Skriv inn epostadressen du meldte deg på med." };
  }

  const found = await findStatus(email);
  if (!found) return { status: "ikke_funnet" };

  return {
    status: "funnet",
    fullName: found.full_name,
    className: found.class_name,
    dbStatus: found.status,
    waitlistPosition: found.waitlist_position,
    paid: found.paid,
    deadline: found.status === "plass" && found.spot_granted_at ? paymentDeadline(found.spot_granted_at).toISOString() : null,
  };
}
