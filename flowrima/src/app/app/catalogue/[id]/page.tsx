import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { LyricsView } from "@/components/lyrics/lyrics-view";
import { TrackEditForm } from "@/components/catalogue/track-edit-form";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getTrack } from "@/lib/data/queries";
import { deleteTrack } from "@/lib/actions/tracks";
import { analyzeTrackLyrics } from "@/lib/text/analyze";
import { parseLyrics } from "@/lib/text/parse";
import { schemeLabel } from "@/lib/text/rhymes";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Fiche titre" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

async function TrackDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(`/app/catalogue/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await getTrack(id);
  if (!res) notFound();
  const { track } = res;
  const analysis = track.lyrics ? analyzeTrackLyrics(track.lyrics) : null;
  const sections = track.lyrics ? parseLyrics(track.lyrics) : [];
  const topPattern = analysis ? Object.entries(analysis.rhymes.quatrains).sort((a, b) => b[1] - a[1])[0]?.[0] : null;

  return (
    <>
      <PageHeader
        title={track.title}
        description={`${formatDate(track.release_date)}${track.bpm_manual ? ` · ${track.bpm_manual} BPM` : ""}`}
        actions={Object.entries(track.links).map(([platform, url]) => (
          <Button key={platform} asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {platform} <ExternalLink aria-hidden />
            </a>
          </Button>
        ))}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          {sections.length ? <LyricsView sections={sections} showFlow={false} /> : <p className="text-muted">Pas de paroles.</p>}
        </Card>
        <div className="space-y-4">
          {track.cover_url && (
            <Image src={track.cover_url} alt={`Pochette de ${track.title}`} width={320} height={320} className="w-full rounded-2xl" unoptimized />
          )}
          {analysis && (
            <Card className="space-y-3">
              <CardTitle>Mesures calculées</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={m.catalogue.syllablesAvg} value={`${analysis.syllables.avg}`} />
                <Stat label={m.catalogue.rhymeDensity} value={`${Math.round(analysis.rhymes.density * 100)} %`} />
                <Stat label="Rimes multisyllabiques" value={`${Math.round(analysis.rhymes.multiRate * 100)} %`} />
                <Stat label="Rimes internes / ligne" value={`${analysis.rhymes.internalPerLine}`} />
                <Stat label="Lignes" value={`${analysis.lineCount}`} />
                <Stat label="Répétition" value={`${Math.round(analysis.structure.repetitionRate * 100)} %`} />
              </div>
              {topPattern && <p className="text-sm text-muted">Schéma dominant : {schemeLabel(topPattern)}</p>}
              <p className="text-sm text-muted">
                {m.catalogue.structure} : {analysis.sections.map((s) => `${s.label} (${s.bars})`).join(" · ")}
              </p>
            </Card>
          )}
        </div>
      </div>
      <details className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-semibold">{m.common.edit}</summary>
        <div className="mt-4">
          <TrackEditForm track={track} />
        </div>
      </details>
      <form action={deleteTrack} className="mt-4">
        <input type="hidden" name="id" value={track.id} />
        <Button type="submit" variant="ghost" className="text-danger">{m.common.delete} ce titre</Button>
      </form>
      <Link href="/app/catalogue" className="mt-2 inline-block text-sm text-accent-text">← {m.catalogue.title}</Link>
    </>
  );
}

export default function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TrackDetail params={params} />
    </Suspense>
  );
}
