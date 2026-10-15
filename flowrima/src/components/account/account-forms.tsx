"use client";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldError, Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  deleteAccount, setOptin, updateDisplayName, updatePassword, type AccountState,
} from "@/lib/actions/account";
import { startCheckout, type BillingState } from "@/lib/actions/billing";
import { requestVerification } from "@/lib/actions/artist";
import { m } from "@/i18n";
import { cn } from "@/lib/utils";

export function DisplayNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateDisplayName, null);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="displayName">Nom affiché</Label>
        <Input id="displayName" name="displayName" defaultValue={name} maxLength={80} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{m.common.save}</Button>
      {state && <p className={cn("text-sm", state.ok ? "text-success" : "text-danger")} role="status">{state.message}</p>}
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(updatePassword, null);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>Mettre à jour</Button>
      {state && <p className={cn("text-sm", state.ok ? "text-success" : "text-danger")} role="status">{state.message}</p>}
    </form>
  );
}

export function OptinSwitch({ kind, label, initial }: { kind: "training_optin" | "marketing_optin"; label: string; initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
      <span className="text-sm">{label}</span>
      <Switch
        checked={checked}
        disabled={pending}
        aria-label={label}
        onCheckedChange={(v) => {
          setChecked(v);
          start(async () => {
            const res = await setOptin(kind, v);
            if (!res?.ok) {
              setChecked(!v);
              toast(res?.message ?? m.common.error, "error");
            }
          });
        }}
      />
    </label>
  );
}

export function CheckoutForm({ trialAvailable }: { trialAvailable: boolean }) {
  const [state, action, pending] = useActionState<BillingState, FormData>(startCheckout, null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="interval" value={interval} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Facturation">
        {(["month", "year"] as const).map((iv) => (
          <button
            key={iv}
            type="button"
            role="radio"
            aria-checked={interval === iv}
            onClick={() => setInterval(iv)}
            className={cn(
              "rounded-xl border p-3 text-left",
              interval === iv ? "border-accent ring-1 ring-accent" : "border-border",
            )}
          >
            <span className="block text-sm font-semibold">{iv === "month" ? m.account.monthly : m.account.yearly}</span>
            <span className="text-sm text-muted">{iv === "month" ? "12,99 € / mois" : "9,99 € / mois (119,88 € / an)"}</span>
          </button>
        ))}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="cgv" required />
        <span>J&apos;accepte les <a href="/legal/cgv" target="_blank" className="underline">CGV</a>.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="waiver" required />
        <span>
          Je demande l&apos;accès immédiat au service et je renonce expressément à mon droit de rétractation pour ce contenu numérique.
        </span>
      </label>
      <FieldError>{state && !state.ok ? state.message : null}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m.common.loading : trialAvailable ? `${m.account.subscribe} — ${m.account.trial}` : m.account.subscribe}
      </Button>
      <p className="text-xs text-muted">Paiement sécurisé par Stripe. TVA calculée selon ton pays. Résiliable en un clic.</p>
    </form>
  );
}

export function DeleteAccountDialog() {
  const [state, action, pending] = useActionState<AccountState, FormData>(deleteAccount, null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">{m.account.deleteAccount}</Button>
      </DialogTrigger>
      <DialogContent title={m.account.deleteAccount} description={m.account.deleteConfirm}>
        <form action={action} className="space-y-3">
          <Label htmlFor="confirm">Tape SUPPRIMER pour confirmer</Label>
          <Input id="confirm" name="confirm" autoComplete="off" required />
          <FieldError>{state && !state.ok ? state.message : null}</FieldError>
          <Button type="submit" variant="destructive" className="w-full" disabled={pending}>
            Supprimer définitivement
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VerificationRequest({ status, code }: { status: string; code: string | null }) {
  const [current, setCurrent] = useState({ status, code });
  const [pending, start] = useTransition();
  if (current.status === "verified") return <p className="text-sm text-success">✓ Artiste vérifié</p>;
  return (
    <div className="space-y-2 text-sm">
      {current.code ? (
        <p>
          Ajoute le code <strong className="font-mono">{current.code}</strong> dans ta bio Instagram (lien renseigné dans ton profil) : notre
          équipe vérifie sous 48 h, puis tu peux le retirer.
        </p>
      ) : (
        <p className="text-muted">Le badge « artiste vérifié » rassure les beatmakers et les labels avec qui tu partages tes projets.</p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await requestVerification();
            if (res?.ok) setCurrent({ status: "pending", code: res.message });
          })
        }
      >
        {current.code ? "Générer un nouveau code" : "Demander la vérification"}
      </Button>
    </div>
  );
}
