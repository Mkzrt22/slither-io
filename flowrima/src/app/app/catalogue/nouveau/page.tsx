import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { ImportPageForm } from "@/components/catalogue/import-page-form";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { getTracks, getUsage } from "@/lib/data/queries";
import { redirect } from "next/navigation";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Importer un titre" };

async function ImportContent() {
  await requireUser("/app/catalogue/nouveau");
  const artist = await getActiveArtist();
  if (!artist) redirect("/app/onboarding");
  const [tracks, usage] = await Promise.all([getTracks(artist.id), getUsage()]);
  const max = usage?.limits.tracks_max ?? 3;
  return <ImportPageForm remaining={max === -1 ? -1 : Math.max(0, max - tracks.length)} />;
}

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={m.catalogue.add} description={m.onboarding.importHelp} />
      <Suspense fallback={<PageSkeleton />}>
        <ImportContent />
      </Suspense>
    </div>
  );
}
