import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTracks, getUsage } from "@/lib/data/queries";
import type { TrackAnalysisRow } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Mon catalogue" };

const TONE = { pending: "warning", analyzing: "default", done: "success", error: "danger" } as const;

async function Catalogue() {
  await requireUser("/app/catalogue");
  const artist = await getActiveArtist();
  if (!artist) {
    return (
      <EmptyState
        title="Commence par ton profil d'artiste"
        action={<Button asChild><Link href="/app/onboarding">Configurer</Link></Button>}
      />
    );
  }
  const [tracks, usage] = await Promise.all([getTracks(artist.id), getUsage()]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("track_analyses")
    .select("track_id, syllables_json, rhymes_json")
    .in("track_id", tracks.map((t) => t.id));
  const analyses = new Map(((data as Pick<TrackAnalysisRow, "track_id" | "syllables_json" | "rhymes_json">[] | null) ?? []).map((a) => [a.track_id, a]));
  const max = usage?.limits.tracks_max ?? 3;

  return (
    <>
      <PageHeader
        title={m.catalogue.title}
        description={`${tracks.length}${max === -1 ? "" : ` / ${max}`} titre(s)`}
        actions={
          (max === -1 || tracks.length < max) && (
            <Button asChild>
              <Link href="/app/catalogue/nouveau"><Plus aria-hidden /> {m.catalogue.add}</Link>
            </Button>
          )
        }
      />
      {max !== -1 && tracks.length >= max && (
        <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {m.catalogue.limitReached} <Link href="/app/compte#abonnement" className="underline">{m.common.upgrade}</Link>
        </p>
      )}
      {tracks.length === 0 ? (
        <EmptyState
          title={m.catalogue.empty}
          description={m.catalogue.emptyHelp}
          action={<Button asChild><Link href="/app/catalogue/nouveau">{m.catalogue.add}</Link></Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tracks.map((t) => {
            const a = analyses.get(t.id);
            return (
              <li key={t.id}>
                <Card className="h-full p-3 transition-colors hover:border-accent/60">
                  <Link href={`/app/catalogue/${t.id}`} className="flex gap-3">
                    {t.cover_url ? (
                      <Image src={t.cover_url} alt="" width={64} height={64} className="size-16 shrink-0 rounded-xl object-cover" unoptimized />
                    ) : (
                      <div className="size-16 shrink-0 rounded-xl bg-surface-2" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{t.title}</p>
                      <p className="text-xs text-muted">{formatDate(t.release_date)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={TONE[t.analysis_status]}>{m.catalogue.status[t.analysis_status]}</Badge>
                        {a?.syllables_json && <span className="text-muted">{a.syllables_json.avg} syll./mesure</span>}
                        {a?.rhymes_json && <span className="text-muted">densité {Math.round(a.rhymes_json.density * 100)} %</span>}
                      </div>
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function CataloguePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Catalogue />
    </Suspense>
  );
}
