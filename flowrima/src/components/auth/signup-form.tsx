"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldError, FieldHint, Input, Label } from "@/components/ui/input";
import { signUp, type AuthState } from "@/lib/actions/auth";
import { m } from "@/i18n";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, null);
  if (state?.ok) return <p role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-4">{state.message}</p>;
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="email">{m.auth.email}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </div>
      <div>
        <Label htmlFor="password">{m.auth.password}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <FieldHint>{m.auth.passwordHint}</FieldHint>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="terms" required />
        <span>
          J&apos;accepte les <Link href="/legal/cgu" className="underline" target="_blank">CGU</Link> et la{" "}
          <Link href="/legal/confidentialite" className="underline" target="_blank">politique de confidentialité</Link>.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-muted">
        <Checkbox name="marketing" />
        <span>{m.auth.marketingOptin}</span>
      </label>
      <FieldError>{state && !state.ok ? state.message : null}</FieldError>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? m.common.loading : m.auth.signup}
      </Button>
    </form>
  );
}
