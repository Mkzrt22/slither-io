import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Skeleton } from "@/components/ui/card";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Connexion", robots: { index: false } };

const ERRORS: Record<string, string> = {
  link_expired: "Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau.",
  oauth: "La connexion avec ce fournisseur a échoué.",
  auth: "La connexion a échoué, réessaie.",
};

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/app";
  return (
    <>
      {sp.error && (
        <p role="alert" className="mb-4 rounded-xl border border-danger/40 p-3 text-sm text-danger">
          {ERRORS[sp.error] ?? ERRORS.auth}
        </p>
      )}
      <div className="mb-5">
        <OAuthButtons next={next} />
      </div>
      <LoginForm next={next} />
    </>
  );
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{m.auth.loginTitle}</h1>
      <Suspense fallback={<Skeleton className="h-72" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
      <p className="text-center text-sm text-muted">
        {m.auth.noAccount} <Link href="/inscription" className="font-semibold text-accent-text">{m.nav.signup}</Link>
      </p>
    </div>
  );
}
