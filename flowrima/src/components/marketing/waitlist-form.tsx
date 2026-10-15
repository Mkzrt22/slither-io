"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select } from "@/components/ui/input";
import { joinWaitlist, type WaitlistState } from "@/lib/actions/waitlist";
import { GENRES } from "@/lib/text/flow";

export function WaitlistForm() {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlist, null);
  if (state?.ok) {
    return (
      <p role="status" className="rounded-2xl border border-accent/50 bg-accent/10 p-4 text-base">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <Label htmlFor="wl-email">E-mail</Label>
        <Input id="wl-email" name="email" type="email" required autoComplete="email" inputMode="email" placeholder="toi@exemple.fr" />
      </div>
      <div>
        <Label htmlFor="wl-name">Nom de scène (optionnel)</Label>
        <Input id="wl-name" name="artistName" maxLength={80} autoComplete="nickname" />
      </div>
      <div>
        <Label htmlFor="wl-genre">Genre principal</Label>
        <Select id="wl-genre" name="genre" defaultValue="">
          <option value="">—</option>
          {GENRES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <Checkbox name="interview" />
        <span>Ok pour un entretien de 20 minutes sur ma façon d&apos;écrire (on construit Flowrima avec les artistes).</span>
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {state.message}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="sm:col-span-2">
        {pending ? "Inscription…" : "Rejoindre la liste d'attente"}
      </Button>
      <p className="text-xs text-muted sm:col-span-2">
        On utilise ton e-mail uniquement pour la liste d&apos;attente. Désinscription en 1 clic.
      </p>
    </form>
  );
}
