import "server-only";
import { z } from "zod";
import { parseOsloTime } from "./time";
import { parseAllowedDomains } from "./validation";

const osloTime = z
  .string()
  .transform((v, ctx) => {
    const d = parseOsloTime(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "må være et ISO-tidspunkt, f.eks. 2026-11-05T12:00" });
      return z.NEVER;
    }
    return d;
  });

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  BREVO_API_KEY: z.string().min(5),
  EMAIL_FROM: z.string().min(3),
  EMAIL_FROM_NAME: z.string().default("Billettsalg"),
  ALLOWED_EMAIL_DOMAIN: z
    .string()
    .transform(parseAllowedDomains)
    .refine((d) => d.length > 0, "må inneholde minst ett domene"),
  VIPPS_NUMBER: z.string().min(1),
  SALES_OPEN_AT: osloTime,
  SALES_CLOSE_AT: z.preprocess((v) => (v === "" ? undefined : v), osloTime.optional()),
  ADMIN_PASSWORD: z.string().min(12, "må være minst 12 tegn"),
  EVENT_NAME: z.string().default("Skolearrangementet"),
  TICKET_PRICE: z.coerce.number().int().positive().default(250),
  RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Config = z.infer<typeof envSchema>;

export const PAYMENT_DEADLINE_MINUTES = 30;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Feil i miljøvariablene:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export type SalesState = "ikke_startet" | "aapen" | "stengt";

export function getSalesState(now = new Date()): SalesState {
  const { SALES_OPEN_AT, SALES_CLOSE_AT } = getConfig();
  if (now < SALES_OPEN_AT) return "ikke_startet";
  if (SALES_CLOSE_AT && now >= SALES_CLOSE_AT) return "stengt";
  return "aapen";
}
