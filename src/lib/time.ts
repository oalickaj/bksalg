export const TIME_ZONE = "Europe/Oslo";

/** Hvor mange minutter Oslo ligger foran UTC på et gitt tidspunkt (60 eller 120). */
function osloOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Tolker et ISO-tidspunkt. Med tidssone (Z eller +01:00) brukes den.
 * Uten tidssone (f.eks. 2026-11-05T12:00) tolkes det som norsk tid
 * (Europe/Oslo), inkludert sommer-/vintertid.
 */
export function parseOsloTime(value: string): Date | null {
  const s = value.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // To runder holder for å treffe riktig side av overgangen til/fra sommertid.
  let guess = wall - osloOffsetMinutes(new Date(wall)) * 60000;
  guess = wall - osloOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

export function formatOsloTime(date: Date | string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatOsloDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatOsloTimestamp(date: Date | string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(new Date(date));
}
