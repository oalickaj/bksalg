import { describe, expect, it } from "vitest";
import { parseOsloTime } from "../src/lib/time";
import { createRegistrationSchema, normalizeEmail, normalizePhone } from "../src/lib/validation";

const schema = createRegistrationSchema(["skole.example.no"]);
const valid = { fullName: "  Ola   Nordmann ", className: "2 sta", phone: "+47 912 34 567", email: " Ola.Nordmann@Skole.Example.NO " };

describe("normalisering", () => {
  it("epost får små bokstaver og trimmes", () => {
    expect(normalizeEmail("  Ola@Skole.Example.NO ")).toBe("ola@skole.example.no");
  });
  it("mobil blir kun siffer uten landskode", () => {
    for (const v of ["91234567", "912 34 567", "+47 91234567", "0047 912-34-567", "47 91 23 45 67"]) {
      expect(normalizePhone(v)).toBe("91234567");
    }
  });
});

describe("skjemavalidering", () => {
  it("godtar gyldig påmelding og normaliserer feltene", () => {
    expect(schema.parse(valid)).toEqual({
      fullName: "Ola Nordmann",
      className: "2STA",
      phone: "91234567",
      email: "ola.nordmann@skole.example.no",
    });
  });

  it.each([
    "ola@gmail.com",
    "ola@skole.example.no.evil.com",
    "ola@evilskole.example.no",
    "ola@sub.skole.example.no",
    "ola+1@skole.example.no",
    "ola@@skole.example.no",
  ])("avviser epost %s", (email) => {
    expect(schema.safeParse({ ...valid, email }).success).toBe(false);
  });

  it.each(["1234", "12345678", "912345678", "abc"])("avviser mobil %s", (phone) => {
    expect(schema.safeParse({ ...valid, phone }).success).toBe(false);
  });

  it("krever fornavn og etternavn", () => {
    expect(schema.safeParse({ ...valid, fullName: "Ola" }).success).toBe(false);
  });
});

describe("SALES_OPEN_AT (Europe/Oslo)", () => {
  it("tolker tid uten sone som norsk vintertid", () => {
    expect(parseOsloTime("2026-11-05T12:00")?.toISOString()).toBe("2026-11-05T11:00:00.000Z");
  });
  it("tolker tid uten sone som norsk sommertid", () => {
    expect(parseOsloTime("2026-06-05T12:00:00")?.toISOString()).toBe("2026-06-05T10:00:00.000Z");
  });
  it("respekterer eksplisitt tidssone", () => {
    expect(parseOsloTime("2026-11-05T12:00:00+01:00")?.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(parseOsloTime("2026-11-05T11:00:00Z")?.toISOString()).toBe("2026-11-05T11:00:00.000Z");
  });
  it("avviser ugyldig verdi", () => {
    expect(parseOsloTime("neste fredag")).toBeNull();
  });
});
