import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BookOpen, Fingerprint, PenLine } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { UsageMeter } from "@/components/app/usage-meter";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardDescription, CardTitle, EmptyState } from "@/components/ui/card";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { getLatestDna, getProjects, getTracks, getUsage } from "@/lib/data/queries";
import { reliabilityLabel } from "@/lib/text/analyze";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Tableau de bord" };

async function Dashboard() {
  await requireUser("/app");
  const artist = await getActiveArtist();
  if (!artist) {
    return (
      <EmptyState
        title="Bienvenue dans ton studio 👋"
        description="Configure ton profil d'artiste et importe 3 titres : on calcule ton ADN artistique en moins de 2 minutes."
        action={
          <Button asChild size="lg">
            <Link href="/app/onboarding">Configurer mon studio</Link>
          </Button>
        }
      />
    );
  }
  const [tracks, dna, projects, usage] = await Promise.all([getTracks(artist.id), getLatestDna(artist.id), getProjects(), getUsage()]);
  const gen = usage?.features.lyrics_generation;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Salut ${artist.stage_name} 👋`}
        description="Prêt à écrire ?"
        actions={
          <Button asChild size="lg">
            <Link href="/app/studio"><PenLine aria-hidden /> Écrire un morceau</Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="space-y-2">
          <BookOpen className="size-5 text-accent-text" aria-hidden />
          <CardTitle>{tracks.length} titre{tracks.length > 1 ? "s" : ""}</CardTitle>
          <CardDescription>
            {usage && usage.limits.tracks_max !== -1 ? `sur ${usage.limits.tracks_max} inclus dans ton plan` : "dans ton catalogue"}
          </CardDescription>
          <Link href={tracks.length ? "/app/catalogue" : "/app/catalogue/nouveau"} className="inline-flex items-center gap-1 text-sm text-accent-text">
            {tracks.length ? "Voir le catalogue" : "Importer un titre"} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
        <Card className="space-y-2">
          <Fingerprint className="size-5 text-accent-text" aria-hidden />
          <CardTitle>{dna ? `ADN v${dna.version}` : "ADN à générer"}</CardTitle>
          <CardDescription>
            {dna
              ? `Fiabilité ${reliabilityLabel(dna.reliability_score ?? 0)} (${dna.reliability_score}/100) · ${dna.track_count} titres`
              : tracks.length >= 3 ? "Tu as assez de titres : lance l'analyse." : "Importe au moins 3 titres."}
          </CardDescription>
          <Link href="/app/adn" className="inline-flex items-center gap-1 text-sm text-accent-text">
            {dna ? "Voir mon ADN" : "Analyser"} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
        <Card className="space-y-2">
          <PenLine className="size-5 text-accent-text" aria-hidden />
          <CardTitle>
            {gen ? (gen.limit === -1 ? "Illimité" : `${Math.max(0, gen.limit - gen.used)} génération(s)`) : "—"}
          </CardTitle>
          <CardDescription>restantes ce mois-ci</CardDescription>
          {usage?.plan === "free" && (
            <Link href="/app/compte#abonnement" className="inline-flex items-center gap-1 text-sm text-accent-text">
              {m.common.upgrade} <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Projets récents</CardTitle>
            <Link href="/app/projets" className="text-sm text-accent-text">Tout voir</Link>
          </div>
          {projects.length === 0 ? (
            <p className="text-sm text-muted">{m.projects.emptyHelp}</p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link href={`/app/studio/${p.id}`} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.title}</span>
                      <span className="text-xs text-muted">{m.projects.updated} {formatDate(p.updated_at)}</span>
                    </span>
                    <Badge>{m.projects.status[p.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle className="mb-3">{m.account.usage}</CardTitle>
          {usage && <UsageMeter usage={usage} features={["lyrics_generation", "retouch", "dna_analysis"]} />}
          <p className="mt-4 text-xs text-muted">{m.studio.sacemNotice}</p>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
