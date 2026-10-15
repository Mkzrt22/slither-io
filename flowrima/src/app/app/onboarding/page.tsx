import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveDnaJob, getLatestDna, getTracks, getUsage } from "@/lib/data/queries";
import type { PlatformLinkRow } from "@/lib/db/types";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Configuration" };

async function Onboarding() {
  await requireUser("/app/onboarding");
  const artist = await getActiveArtist();
  const supabase = await createClient();
  const [links, tracks, dna, job, usage] = await Promise.all([
    artist ? supabase.from("platform_links").select("*").eq("artist_id", artist.id) : Promise.resolve({ data: [] }),
    artist ? getTracks(artist.id) : Promise.resolve([]),
    artist ? getLatestDna(artist.id) : Promise.resolve(null),
    getActiveDnaJob(),
    getUsage(),
  ]);
  const trackCount = tracks.length;
  const initialStep = !artist ? 0 : trackCount === 0 ? 1 : 2;
  return (
    <OnboardingWizard
      initialStep={initialStep}
      artist={artist}
      links={(links.data as PlatformLinkRow[] | null) ?? []}
      trackCount={trackCount}
      tracksMax={usage?.limits.tracks_max ?? 3}
      dnaReady={Boolean(dna)}
      activeJobId={job?.id ?? null}
    />
  );
}

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={m.onboarding.title} />
      <Suspense fallback={<PageSkeleton />}>
        <Onboarding />
      </Suspense>
    </div>
  );
}
