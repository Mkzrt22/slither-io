import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Inscription", robots: { index: false } };

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{m.auth.signupTitle}</h1>
        <p className="mt-2 text-muted">Gratuit : 3 titres analysés et 3 générations par mois.</p>
      </div>
      <OAuthButtons next="/app/onboarding" />
      <SignupForm />
      <p className="text-center text-sm text-muted">
        {m.auth.hasAccount} <Link href="/connexion" className="font-semibold text-accent-text">{m.nav.login}</Link>
      </p>
    </div>
  );
}
