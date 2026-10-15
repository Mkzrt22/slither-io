import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/app/page-header";
import { ProjectStudio } from "@/components/studio/project-studio";
import type { GenerationParams } from "@/components/studio/params-panel";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLatestDna, getProject, getUsage } from "@/lib/data/queries";
import { studioDefaults } from "@/lib/services/studio-defaults";
import type { ArtistProfileRow } from "@/lib/db/types";
import { siteUrl } from "@/lib/utils";

export const metadata: Metadata = { title: "Studio" };

async function ProjectContent({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireUser(`/app/studio/${projectId}`);
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const data = await getProject(projectId);
  if (!data) notFound();
  const supabase = await createClient();
  const [{ data: artist }, usage, { data: lastGen }] = await Promise.all([
    supabase.from("artist_profiles").select("*").eq("id", data.project.artist_id).single(),
    getUsage(),
    supabase
      .from("generations")
      .select("params_json")
      .eq("project_id", projectId)
      .eq("type", "lyrics")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const a = (artist as ArtistProfileRow | null) ?? (await getActiveArtist());
  if (!a) notFound();
  const dna = await getLatestDna(a.id);
  const gen = usage?.features.lyrics_generation;
  const lastParams = (lastGen as { params_json: Partial<GenerationParams> & { syllableTarget?: unknown; dnaVersion?: unknown } } | null)?.params_json ?? null;
  if (lastParams) {
    delete lastParams.syllableTarget;
    delete lastParams.dnaVersion;
  }
  return (
    <ProjectStudio
      project={data.project}
      versions={data.versions}
      defaults={studioDefaults(a, dna)}
      lastParams={lastParams}
      quotaLeft={gen ? (gen.limit === -1 ? -1 : Math.max(0, gen.limit - gen.used)) : null}
      pdfAllowed={Boolean(usage?.limits.pdf_export)}
      siteUrl={siteUrl()}
    />
  );
}

export default function ProjectStudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectContent params={params} />
    </Suspense>
  );
}
