// Delt validering – brukes både i nettleseren og på serveren.
import { z } from "zod";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Kun siffer, og uten landskode (+47 / 0047), slik at samme nummer alltid blir likt. */
export function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0047") && digits.length === 12) digits = digits.slice(4);
  else if (digits.startsWith("47") && digits.length === 10) digits = digits.slice(2);
  return digits;
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeClass(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function parseAllowedDomains(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

const EMAIL_RE = /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function createRegistrationSchema(allowedDomains: string[]) {
  const domainText = allowedDomains.map((d) => `@${d}`).join(" eller ");

  return z.object({
    fullName: z
      .string()
      .transform(normalizeName)
      .pipe(
        z
          .string()
          .min(3, "Skriv inn fullt navn.")
          .max(100, "Navnet er for langt.")
          .regex(/^[\p{L}][\p{L}' .-]*\s[\p{L}' .-]*[\p{L}.]$/u, "Skriv inn både fornavn og etternavn."),
      ),
    className: z
      .string()
      .transform(normalizeClass)
      .pipe(
        z
          .string()
          .min(1, "Skriv inn klassen din.")
          .max(20, "Klassen er for lang.")
          .regex(/^[\p{L}\d-]+$/u, "Klassen kan bare inneholde bokstaver og tall, f.eks. 2STA."),
      ),
    phone: z
      .string()
      .transform(normalizePhone)
      .pipe(z.string().regex(/^[49]\d{7}$/, "Skriv inn et norsk mobilnummer med 8 siffer.")),
    email: z
      .string()
      .transform(normalizeEmail)
      .pipe(
        z
          .string()
          .max(200, "Eposten er for lang.")
          .refine((e) => !e.split("@")[0]?.includes("+"), "Bruk skoleeposten din uten «+».")
          .refine((e) => EMAIL_RE.test(e), "Skriv inn en gyldig epostadresse.")
          .refine(
            (e) => allowedDomains.includes(e.split("@")[1] ?? ""),
            `Du må bruke skoleeposten din (${domainText}).`,
          ),
      ),
  });
}

export type RegistrationInput = z.infer<ReturnType<typeof createRegistrationSchema>>;
export type RegistrationField = keyof RegistrationInput;
