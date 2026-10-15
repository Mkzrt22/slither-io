"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { signIn, signInWithMagicLink, type AuthState } from "@/lib/actions/auth";
import { m } from "@/i18n";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [pwState, pwAction, pwPending] = useActionState<AuthState, FormData>(signIn, null);
  const [mlState, mlAction, mlPending] = useActionState<AuthState, FormData>(signInWithMagicLink, null);
  const state = mode === "password" ? pwState : mlState;

  if (mode === "magic" && mlState?.ok) {
    return <p role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-4">{mlState.message}</p>;
  }
  return (
    <form action={mode === "password" ? pwAction : mlAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="email">{m.auth.email}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </div>
      {mode === "password" && (
        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">{m.auth.password}</Label>
            <Link href="/mot-de-passe" className="text-xs text-accent-text">{m.auth.forgot}</Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        </div>
      )}
      <FieldError>{state && !state.ok ? state.message : null}</FieldError>
      <Button type="submit" className="w-full" disabled={pwPending || mlPending}>
        {mode === "password" ? m.auth.login : m.auth.magicLink}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-accent-text"
        onClick={() => setMode(mode === "password" ? "magic" : "password")}
      >
        {mode === "password" ? "Me connecter sans mot de passe" : "Utiliser mon mot de passe"}
      </button>
    </form>
  );
}
