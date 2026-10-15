"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { requestPasswordReset, type AuthState } from "@/lib/actions/auth";
import { m } from "@/i18n";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordReset, null);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{m.auth.forgot}</h1>
      {state?.ok ? (
        <p role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-4">{state.message}</p>
      ) : (
        <form action={action} className="space-y-4">
          <div>
            <Label htmlFor="email">{m.auth.email}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <FieldError>{state && !state.ok ? state.message : null}</FieldError>
          <Button type="submit" className="w-full" disabled={pending}>Recevoir un lien</Button>
        </form>
      )}
      <Link href="/connexion" className="block text-center text-sm text-accent-text">← {m.nav.login}</Link>
    </div>
  );
}
