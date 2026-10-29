"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Nedtelling til salget åpner. Bruker serverens klokke (ikke elevens),
 * slik at en feil klokke på mobilen ikke gir feil nedtelling. Selve
 * sperren ligger uansett på serveren.
 */
export function Countdown({ openAt, serverNow }: { openAt: number; serverNow: number }) {
  const router = useRouter();
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(id);
  }, [offset]);

  const remaining = Math.max(0, openAt - now);

  useEffect(() => {
    if (remaining > 0) return;
    // Litt tilfeldig forsinkelse så ikke alle laster inn i samme millisekund.
    const t = setTimeout(() => router.refresh(), 200 + Math.random() * 800);
    return () => clearTimeout(t);
  }, [remaining, router]);

  const s = Math.floor(remaining / 1000);
  const parts = [
    { value: Math.floor(s / 86400), label: "dager" },
    { value: Math.floor((s % 86400) / 3600), label: "timer" },
    { value: Math.floor((s % 3600) / 60), label: "min" },
    { value: s % 60, label: "sek" },
  ];

  if (remaining === 0) {
    return <p className="countdown-done">Påmeldingen åpner nå …</p>;
  }

  return (
    <div className="countdown" aria-live="off">
      {parts.map((p) => (
        <div key={p.label}>
          <span className="num">{String(p.value).padStart(2, "0")}</span>
          <span className="lbl">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
