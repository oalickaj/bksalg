"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { checkPassword, createSession, destroySession, requireAdmin } from "@/lib/admin-auth";
import { sendMail, spotMail } from "@/lib/email";
import { checkRateLimit, getClientIp, releaseSpot, setPaid } from "@/lib/registrations";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await getClientIp();
  if (!(await checkRateLimit(`admin-login:${ip}`, 10, 900))) {
    return { error: "For mange forsøk. Vent 15 minutter." };
  }
  const password = z.string().max(200).safeParse(formData.get("password"));
  if (!password.success || !checkPassword(password.data)) {
    return { error: "Feil passord." };
  }
  await createSession();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/admin/login");
}

const idSchema = z.uuid();

/** Tar vare på søk og filter når siden lastes på nytt etter en handling. */
function back(formData: FormData, flash: string): never {
  const params = new URLSearchParams(String(formData.get("returnQuery") ?? ""));
  params.set("melding", flash);
  revalidatePath("/admin");
  redirect(`/admin?${params.toString()}`);
}

export async function setPaidAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("id"));
  const paid = formData.get("paid") === "true";
  const ok = await setPaid(id, paid);
  back(formData, ok ? (paid ? "Markert som betalt." : "Betaling fjernet.") : "Kunne ikke endre betaling (personen har ikke plass).");
}

export async function releaseAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("id"));
  const rows = await releaseSpot(id);
  const first = rows[0];

  if (!first || first.result !== "frigitt") {
    const why =
      first?.result === "betalt"
        ? "Kan ikke frigi en plass som er betalt. Fjern betalingen først."
        : "Plassen kunne ikke frigis.";
    back(formData, why);
  }

  const promoted = rows.filter((r) => r.result === "opprykk" && r.email && r.full_name && r.spot_granted_at);
  after(async () => {
    for (const p of promoted) {
      await sendMail(spotMail(p.email!, p.full_name!, p.class_name ?? "", new Date(p.spot_granted_at!), true));
    }
  });

  back(
    formData,
    promoted.length
      ? `Plassen til ${first.full_name} er frigitt. ${promoted.map((p) => p.full_name).join(", ")} har rykket opp og fått epost.`
      : `Plassen til ${first.full_name} er frigitt. Ingen på ventelisten rykket opp.`,
  );
}
