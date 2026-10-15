"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="fr" data-theme="dark">
      <body style={{ background: "#0b0b10", color: "#f1f1f4", fontFamily: "system-ui", padding: 32 }}>
        <h1>Flowrima est momentanément indisponible</h1>
        <p>L&apos;erreur a été signalée. Réessaie dans un instant.</p>
        <button onClick={reset} style={{ marginTop: 16, padding: "10px 16px", borderRadius: 12, background: "#c6ff2e", color: "#0b0b10", border: 0 }}>
          Réessayer
        </button>
      </body>
    </html>
  );
}
