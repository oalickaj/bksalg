"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerAction, type RegisterState } from "@/app/actions";
import { createRegistrationSchema, type RegistrationField } from "@/lib/validation";
import { formatOsloTime } from "@/lib/time";

const FIELDS: { name: RegistrationField; label: string; type: string; autoComplete: string; inputMode?: "tel" | "email"; placeholder: string }[] = [
  { name: "fullName", label: "Fullt navn", type: "text", autoComplete: "name", placeholder: "Ola Nordmann" },
  { name: "className", label: "Klasse", type: "text", autoComplete: "off", placeholder: "2STA" },
  { name: "phone", label: "Mobilnummer", type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "912 34 567" },
  { name: "email", label: "Skoleepost", type: "email", autoComplete: "email", inputMode: "email", placeholder: "" },
];

export function RegistrationForm({ allowedDomains, ticketPrice, vippsNumber }: { allowedDomains: string[]; ticketPrice: number; vippsNumber: string }) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(registerAction, { status: "idle" });
  const [clientErrors, setClientErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const schema = createRegistrationSchema(allowedDomains);

  if (state.status === "duplikat") {
    return (
      <div className="card warn" role="status">
        <h2>Du er allerede påmeldt</h2>
        <p>Denne eposten eller dette mobilnummeret er allerede registrert. Hver elev kan bare melde seg på én gang.</p>
        <p>
          Har du glemt om du fikk plass eller venteliste? Sjekk <Link href="/status">status her</Link>.
        </p>
      </div>
    );
  }

  if (state.status === "registered") {
    if (state.dbStatus === "plass") {
      const deadline = state.spotGrantedAt ? new Date(new Date(state.spotGrantedAt).getTime() + 30 * 60_000) : null;
      return (
        <div className="card success" role="status">
          <h2>Du har fått plass!</h2>
          <p>
            <strong>{state.fullName}</strong>, {state.className}
          </p>
          <p>
            Plassen er ikke din før betalingen er registrert. Du må vippse innen <strong>30 minutter</strong>:
          </p>
          <div className="pay">
            <span>
              Beløp: <strong>{ticketPrice} kr</strong>
            </span>
            <span>
              Vipps til: <strong>{vippsNumber}</strong>
            </span>
            {deadline && (
              <span>
                Frist: <strong>kl. {formatOsloTime(deadline)}</strong>
              </span>
            )}
            <span>
              Merk betalingen med:{" "}
              <strong>
                {state.fullName}, {state.className}
              </strong>
            </span>
          </div>
          <p className="small">
            Betaler du ikke innen fristen, kan plassen bli gitt til neste på ventelisten. Du har også fått denne
            informasjonen på epost.
          </p>
        </div>
      );
    }
    return (
      <div className="card info" role="status">
        <h2>Du står på ventelisten</h2>
        <p>
          <strong>{state.fullName}</strong>, {state.className}
        </p>
        <p>Alle plassene var tatt da du meldte deg på. Ditt plassnummer på ventelisten er:</p>
        <p className="bignum">{state.waitlistPosition}</p>
        <p>
          Hvis noen ikke betaler innen fristen, rykker første på ventelisten opp. Da får du epost og må vippse{" "}
          {ticketPrice} kr innen 30 minutter.
        </p>
        <p>
          <strong>Ikke betal noe nå.</strong>
        </p>
        <p className="muted small">
          Du får ikke epost med én gang. Lagre eposten din, og sjekk{" "}
          <Link href="/status">status her</Link> senere for å se om du har rykket opp.
        </p>
      </div>
    );
  }

  const serverErrors = state.status === "error" ? state.fieldErrors ?? {} : {};
  const values = state.status === "error" ? state.values ?? {} : {};

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const result = schema.safeParse(data);
    if (!result.success) {
      e.preventDefault();
      const errs: Partial<Record<RegistrationField, string>> = {};
      for (const issue of result.error.issues) errs[issue.path[0] as RegistrationField] ??= issue.message;
      setClientErrors(errs);
    } else {
      setClientErrors({});
    }
  }

  const errors = { ...serverErrors, ...clientErrors };
  const domainHint = allowedDomains.map((d) => `@${d}`).join(" eller ");

  return (
    <form action={formAction} onSubmit={onSubmit} className="card form" noValidate>
      {state.status === "error" && state.message && Object.keys(clientErrors).length === 0 && (
        <p className="alert" role="alert">
          {state.message}
        </p>
      )}

      {FIELDS.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            type={f.type}
            inputMode={f.inputMode}
            autoComplete={f.autoComplete}
            placeholder={f.name === "email" ? `fornavn.etternavn@${allowedDomains[0] ?? ""}` : f.placeholder}
            defaultValue={values[f.name] ?? ""}
            aria-invalid={errors[f.name] ? true : undefined}
            aria-describedby={errors[f.name] ? `${f.name}-error` : f.name === "email" ? "email-hint" : undefined}
            required
          />
          {f.name === "email" && !errors.email && (
            <small id="email-hint" className="muted">
              Må slutte på {domainHint}
            </small>
          )}
          {errors[f.name] && (
            <small id={`${f.name}-error`} className="error">
              {errors[f.name]}
            </small>
          )}
        </div>
      ))}

      {/* Honningkrukke for roboter – skjult for mennesker.
          Navn/merkelapp er med vilje generiske: ord som "nettside"/"website"
          trigger autofyll fra passordbehandlere selv på skjulte felt, og da
          blir ekte brukere feilaktig behandlet som roboter. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="hp-check">Ikke fyll ut</label>
        <input
          id="hp-check"
          name="hp_check"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
        />
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Melder på …" : "Meld meg på"}
      </button>
      <p className="muted small">
        Plassen avgjøres med én gang av tidspunktet du trykker. Hver elev kan bare melde seg på én gang, med én
        skoleepost og ett mobilnummer.
      </p>
    </form>
  );
}
