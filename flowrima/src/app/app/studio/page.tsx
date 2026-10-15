import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { NewSongStudio } from "@/components/studio/new-song-studio";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { getLatestDna, getUsage } from "@/lib/data/queries";
import { studioDefaults } from "@/lib/services/studio-defaults";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Studio d'écriture" };

async function Studio({ searchParams }: { searchParams: Promise<{ sujet?: string }> }) {
  await requireUser("/app/studio");
  const artist = await getActiveArtist();
  if (!artist) {
    return <EmptyState title="Configure d'abord ton profil" action={<Button asChild><Link href="/app/onboarding">Configurer</Link></Button>} />;
  }
  const [dna, usage, sp] = await Promise.all([getLatestDna(artist.id), getUsage(), searchParams]);
  if (!dna) {
    return (
      <EmptyState
        title={m.studio.noDna}
        description="Le studio écrit à partir de ton ADN artistique : importe tes titres et lance l'analyse (moins de 2 minutes)."
        action={<Button asChild><Link href="/app/adn">Analyser mon ADN</Link></Button>}
      />
    );
  }
  const gen = usage?.features.lyrics_generation;
  const quotaLeft = gen ? (gen.limit === -1 ? -1 : Math.max(0, gen.limit - gen.used)) : null;
  return <NewSongStudio defaults={studioDefaults(artist, dna)} initialSubject={sp.sujet?.slice(0, 600)} quotaLeft={quotaLeft} />;
}

export default function StudioPage({ searchParams }: { searchParams: Promise<{ sujet?: string }> }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={m.studio.newSong} description="Ton sujet, ton ambiance, ta structure : 3 propositions qui sonnent comme toi." />
      <Suspense fallback={<PageSkeleton />}>
        <Studio searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
