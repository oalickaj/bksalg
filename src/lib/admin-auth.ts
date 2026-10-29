import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "./config";

export const ADMIN_COOKIE = "admin_session";
const SESSION_HOURS = 12;

// Nøkkelen er avledet av ADMIN_PASSWORD, så alle økter blir ugyldige
// hvis passordet byttes.
function sign(payload: string): string {
  const key = createHmac("sha256", "billettsalg-admin").update(getConfig().ADMIN_PASSWORD).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  // Sammenligner HMAC-er slik at lengden på passordet ikke lekker.
  return safeEqual(sign(`pw:${input}`), sign(`pw:${getConfig().ADMIN_PASSWORD}`));
}

export async function createSession(): Promise<void> {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const value = `${expires}.${sign(`admin:${expires}`)}`;
  (await cookies()).set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return safeEqual(signature, sign(`admin:${expires}`));
}

/** Brukes øverst i alle admin-sider, server actions og ruter. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
