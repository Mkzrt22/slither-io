import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { UsageMeter } from "@/components/app/usage-meter";
import {
  CheckoutForm, DeleteAccountDialog, DisplayNameForm, OptinSwitch, PasswordForm, VerificationRequest,
} from "@/components/account/account-forms";
import { ArtistProfileForm } from "@/components/onboarding/artist-profile-form";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getActiveArtist, getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSubscription, getUsage } from "@/lib/data/queries";
import { openBillingPortal } from "@/lib/actions/billing";
import type { PlatformLinkRow } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Compte" };

const PLAN_LABEL = { free: "Découverte", artist: "Artiste", pro: "Pro", label: "Label / Studio" } as const;
const STATUS_LABEL: Record<string, string> = {
  trialing: "Essai gratuit", active: "Actif", past_due: "Paiement en retard", canceled: "Résilié", unpaid: "Impayé", incomplete: "Incomplet",
};

async function Account({ searchParams }: { searchParams: Promise<{ paiement?: string; reset?: string }> }) {
  await requireUser("/app/compte");
  const [profile, usage, sub, artist, sp] = await Promise.all([getProfile(), getUsage(), getSubscription(), getActiveArtist(), searchParams]);
  if (!profile) return null;
  const supabase = await createClient();
  const { data: links } = artist
    ? await supabase.from("platform_links").select("*").eq("artist_id", artist.id)
    : { data: [] };

  return (
    <div className="space-y-6">
      {sp.paiement === "ok" && (
        <p role="status" className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
          Paiement confirmé : ton plan est actif. Les nouveaux quotas sont disponibles immédiatement.
        </p>
      )}
      {sub?.status === "past_due" && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">{m.account.pastDue}</p>
      )}

      <Card id="abonnement" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{m.account.plan} : {PLAN_LABEL[profile.plan]}</CardTitle>
            {sub && (
              <CardDescription>
                {STATUS_LABEL[sub.status] ?? sub.status}
                {sub.trial_end && sub.status === "trialing" && ` jusqu'au ${formatDate(sub.trial_end)}`}
                {sub.current_period_end && sub.status !== "trialing" && (sub.cancel_at_period_end ? ` · se termine le ${formatDate(sub.current_period_end)}` : ` · renouvellement le ${formatDate(sub.current_period_end)}`)}
              </CardDescription>
            )}
          </div>
          <Badge tone={profile.plan === "free" ? "default" : "accent"}>{PLAN_LABEL[profile.plan]}</Badge>
        </div>
        {usage && (
          <div>
            <p className="mb-2 text-sm font-medium">{m.account.usage} (depuis le {formatDate(usage.period_start)})</p>
            <UsageMeter usage={usage} features={["lyrics_generation", "retouch", "assist", "dna_analysis", "export_pdf"]} />
            <p className="mt-2 text-xs text-muted">
              Titres : {usage.tracks}{usage.limits.tracks_max === -1 ? "" : ` / ${usage.limits.tracks_max}`} · Crédits prod : {usage.credits}
            </p>
          </div>
        )}
        {profile.plan === "free" ? (
          <div className="rounded-2xl border border-accent/50 p-4">
            <p className="mb-1 font-semibold">Plan Artiste</p>
            <p className="mb-4 text-sm text-muted">30 titres, 40 générations par mois, retouches illimitées, export PDF fiche studio.</p>
            <CheckoutForm trialAvailable={!sub} />
          </div>
        ) : (
          <form action={openBillingPortal}>
            <Button type="submit" variant="outline">{m.account.manage}</Button>
            <p className="mt-2 text-xs text-muted">Moyen de paiement, factures, changement de formule ou résiliation en un clic.</p>
          </form>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>Profil</CardTitle>
        <DisplayNameForm name={profile.display_name ?? ""} />
        <p className="text-sm text-muted">E-mail : {profile.email}</p>
        <details open={sp.reset === "1"}>
          <summary className="cursor-pointer text-sm text-accent-text">Changer mon mot de passe</summary>
          <div className="mt-3"><PasswordForm /></div>
        </details>
      </Card>

      <Card className="space-y-4">
        <CardTitle>Profil artiste</CardTitle>
        <ArtistProfileForm artist={artist} links={(links as PlatformLinkRow[] | null) ?? []} submitLabel={m.common.save} />
        {artist && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-semibold">Badge « artiste vérifié » (optionnel)</p>
            <VerificationRequest status={artist.verification_status} code={artist.verification_code} />
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>{m.account.privacy}</CardTitle>
        <OptinSwitch kind="training_optin" label={m.account.trainingOptin} initial={profile.training_optin} />
        <OptinSwitch kind="marketing_optin" label={m.account.marketingOptin} initial={profile.marketing_optin} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/api/account/export" download><Download aria-hidden /> {m.account.exportData}</a>
          </Button>
          <DeleteAccountDialog />
        </div>
        <p className="text-xs text-muted">
          Données hébergées dans l&apos;UE. Détails : <Link href="/legal/confidentialite" className="underline">politique de confidentialité</Link>.
        </p>
      </Card>
    </div>
  );
}

export default function AccountPage({ searchParams }: { searchParams: Promise<{ paiement?: string; reset?: string }> }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={m.account.title} />
      <Suspense fallback={<PageSkeleton />}>
        <Account searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
