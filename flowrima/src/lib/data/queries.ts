import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import type {
  ArtistDnaRow, JobRow, LyricVersionRow, MyUsage, ProjectRow, ProjectStatus, SubscriptionRow, TrackAnalysisRow, TrackRow,
} from "@/lib/db/types";

/** All reads go through the user-scoped client: Row Level Security applies. */

export const getUsage = cache(async (): Promise<MyUsage | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_usage");
  return (data as MyUsage | null) ?? null;
});

export const getTracks = cache(async (artistId: string): Promise<TrackRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tracks")
    .select("*")
    .eq("artist_id", artistId)
    .order("release_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data as TrackRow[] | null) ?? [];
});

export async function getTrack(id: string): Promise<{ track: TrackRow; analysis: TrackAnalysisRow | null } | null> {
  const supabase = await createClient();
  const [{ data: track }, { data: analysis }] = await Promise.all([
    supabase.from("tracks").select("*").eq("id", id).maybeSingle(),
    supabase.from("track_analyses").select("*").eq("track_id", id).maybeSingle(),
  ]);
  if (!track) return null;
  return { track: track as TrackRow, analysis: (analysis as TrackAnalysisRow | null) ?? null };
}

export const getLatestDna = cache(async (artistId: string): Promise<ArtistDnaRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("artist_dna")
    .select("*")
    .eq("artist_id", artistId)
    .eq("status", "ready")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ArtistDnaRow | null) ?? null;
});

export async function getActiveDnaJob(): Promise<JobRow | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("type", "dna_analysis")
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function getProjects(opts: { q?: string; status?: ProjectStatus } = {}): Promise<ProjectRow[]> {
  const supabase = await createClient();
  let query = supabase.from("projects").select("*").order("updated_at", { ascending: false }).limit(200);
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.q) query = query.or(`title.ilike.%${opts.q.replace(/[%,()]/g, "")}%,theme.ilike.%${opts.q.replace(/[%,()]/g, "")}%`);
  const { data } = await query;
  return (data as ProjectRow[] | null) ?? [];
}

export async function getProject(id: string): Promise<{ project: ProjectRow; versions: LyricVersionRow[] } | null> {
  const supabase = await createClient();
  const [{ data: project }, { data: versions }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("lyric_versions").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (!project) return null;
  return { project: project as ProjectRow, versions: (versions as LyricVersionRow[] | null) ?? [] };
}

export const getSubscription = cache(async (): Promise<SubscriptionRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
});
