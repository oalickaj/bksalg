import "server-only";
import { headers } from "next/headers";
import { PAYMENT_DEADLINE_MINUTES } from "./config";
import { db } from "./supabase";

export type DbStatus = "plass" | "venteliste" | "frigitt";

export type Registration = {
  id: string;
  created_at: string;
  full_name: string;
  class_name: string;
  phone: string;
  email: string;
  status: DbStatus;
  queue_seq: number;
  spot_granted_at: string | null;
  promoted: boolean;
  paid: boolean;
  paid_at: string | null;
  released_at: string | null;
};

const COLUMNS =
  "id, created_at, full_name, class_name, phone, email, status, queue_seq, spot_granted_at, promoted, paid, paid_at, released_at";

export const STATUS_LABEL: Record<DbStatus, string> = {
  plass: "Plass",
  venteliste: "Venteliste",
  frigitt: "Frigitt",
};

export function paymentDeadline(spotGrantedAt: string | Date): Date {
  return new Date(new Date(spotGrantedAt).getTime() + PAYMENT_DEADLINE_MINUTES * 60_000);
}

// ---------------------------------------------------------------------
// Databasekall
// ---------------------------------------------------------------------
export type RegisterResult =
  | {
      result: "ny";
      id: string;
      status: DbStatus;
      waitlistPosition: number | null;
      fullName: string;
      className: string;
      email: string;
      spotGrantedAt: string | null;
    }
  | { result: "duplikat"; matchedOn: "epost" | "mobil"; existingStatus: DbStatus };

export async function registerStudent(input: {
  fullName: string;
  className: string;
  phone: string;
  email: string;
  ip: string;
}): Promise<RegisterResult> {
  const { data, error } = await db()
    .rpc("register_student", {
      p_full_name: input.fullName,
      p_class_name: input.className,
      p_phone: input.phone,
      p_email: input.email,
      p_ip: input.ip,
    })
    .single<{
      result: string;
      id: string | null;
      status: DbStatus | null;
      waitlist_position: number | null;
      full_name: string | null;
      class_name: string | null;
      email: string | null;
      spot_granted_at: string | null;
      matched_on: string | null;
      existing_status: DbStatus | null;
    }>();
  if (error || !data) throw new Error(`register_student feilet: ${error?.message}`);

  if (data.result === "duplikat") {
    return {
      result: "duplikat",
      matchedOn: data.matched_on === "epost" ? "epost" : "mobil",
      existingStatus: data.existing_status ?? "plass",
    };
  }
  return {
    result: "ny",
    id: data.id!,
    status: data.status!,
    waitlistPosition: data.waitlist_position,
    fullName: data.full_name!,
    className: data.class_name!,
    email: data.email!,
    spotGrantedAt: data.spot_granted_at,
  };
}

export type StatusLookup = {
  full_name: string;
  class_name: string;
  status: DbStatus;
  waitlist_position: number | null;
  spot_granted_at: string | null;
  paid: boolean;
};

export async function findStatus(email: string): Promise<StatusLookup | null> {
  const { data, error } = await db().rpc("find_status", { p_email: email });
  if (error) throw new Error(`Statusoppslag feilet: ${error.message}`);
  return (data?.[0] as StatusLookup) ?? null;
}

export type ReleaseRow = {
  result: "frigitt" | "opprykk" | "ikke_funnet" | "betalt" | "ugyldig_status";
  id: string | null;
  full_name: string | null;
  class_name: string | null;
  email: string | null;
  spot_granted_at: string | null;
};

export async function releaseSpot(id: string): Promise<ReleaseRow[]> {
  const { data, error } = await db().rpc("release_spot", { p_id: id });
  if (error) throw new Error(`release_spot feilet: ${error.message}`);
  return (data ?? []) as ReleaseRow[];
}

export async function setPaid(id: string, paid: boolean): Promise<boolean> {
  const { data, error } = await db()
    .from("registrations")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("status", "plass")
    .select("id");
  if (error) throw new Error(`Kunne ikke oppdatere betaling: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Henter alle påmeldinger (Supabase gir maks 1000 rader per kall, så vi blar). */
export async function listAllRegistrations(): Promise<Registration[]> {
  const pageSize = 1000;
  const all: Registration[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from("registrations")
      .select(COLUMNS)
      .order("queue_seq", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Kunne ikke hente påmeldinger: ${error.message}`);
    all.push(...((data ?? []) as Registration[]));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export async function getCapacity(): Promise<number> {
  const { data, error } = await db().from("app_config").select("capacity").eq("id", 1).single<{ capacity: number }>();
  if (error || !data) throw new Error(`Kunne ikke hente kapasitet: ${error?.message}`);
  return data.capacity;
}

// ---------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------
export async function getClientIp(): Promise<string> {
  const h = await headers();
  // På Vercel settes x-forwarded-for av plattformen og kan ikke forfalskes av klienten.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "ukjent";
}

/** true = innenfor grensen. Ved databasefeil slipper vi forespørselen gjennom. */
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("hit_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) {
    console.error("Rate limit feilet", error);
    return true;
  }
  return data === true;
}
