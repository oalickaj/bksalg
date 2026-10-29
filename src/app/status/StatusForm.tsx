"use client";

import { useActionState } from "react";
import { lookupStatusAction, type StatusState } from "./actions";
import { formatOsloTime } from "@/lib/time";

export function StatusForm({ ticketPrice, vippsNumber }: { ticketPrice: number; vippsNumber: string }) {
  const [state, formAction, pending] = useActionState<StatusState, FormData>(lookupStatusAction, { status: "idle" });

  return (
    <>
      <form action={formAction} className="card form">
        <div className="field">
          <label htmlFor="email">Skoleepost</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Søker …" : "Sjekk status"}
        </button>
      </form>

      {state.status === "error" && (
        <p className="alert" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "ikke_funnet" && (
        <div className="card warn">
          <h2>Fant ingen påmelding</h2>
          <p>Vi fant ingen påmelding med denne eposten. Sjekk at du har skrevet den riktig.</p>
        </div>
      )}

      {state.status === "funnet" && state.dbStatus === "plass" && (
        <div className="card success">
          <h2>Du har plass</h2>
          <p>
            <strong>{state.fullName}</strong>, {state.className}
          </p>
          {state.paid ? (
            <p>
              <strong>Betalingen er registrert.</strong> Plassen er din. Vi ses!
            </p>
          ) : (
            <>
              <p>Plassen er ikke bekreftet før betalingen er registrert.</p>
              <div className="pay">
                <span>
                  Beløp: <strong>{ticketPrice} kr</strong>
                </span>
                <span>
                  Vipps til: <strong>{vippsNumber}</strong>
                </span>
                {state.deadline && (
                  <span>
                    Frist: <strong>kl. {formatOsloTime(state.deadline)}</strong>
                  </span>
                )}
                <span>
                  Merk betalingen med:{" "}
                  <strong>
                    {state.fullName}, {state.className}
                  </strong>
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {state.status === "funnet" && state.dbStatus === "venteliste" && (
        <div className="card info">
          <h2>Du står på ventelisten</h2>
          <p>
            <strong>{state.fullName}</strong>, {state.className}
          </p>
          <p className="bignum">{state.waitlistPosition}</p>
          <p>Rykker du opp, får du epost med betalingsinformasjon og en ny frist på 30 minutter.</p>
        </div>
      )}

      {state.status === "funnet" && state.dbStatus === "frigitt" && (
        <div className="card warn">
          <h2>Påmeldingen er frigitt</h2>
          <p>Påmeldingen din er frigitt av arrangøren, som regel fordi betalingen ikke ble registrert innen fristen.</p>
        </div>
      )}
    </>
  );
}
