"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Oups, quelque chose a coincé</h1>
      <p className="text-muted">L&apos;erreur a été signalée à l&apos;équipe. Tes textes sont sauvegardés.</p>
      {error.digest && <p className="font-mono text-xs text-muted">Réf. {error.digest}</p>}
      <Button onClick={reset}>Réessayer</Button>
    </div>
  );
}
