import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { RetouchBody } from "@/lib/studio-schemas";
import { retouchLines, StudioError } from "@/lib/services/studio";
import { syllableTargetFor } from "@/lib/services/targets";
import type { ArtistDnaRow, ArtistProfileRow, ProjectRow } from "@/lib/db/types";

export const maxDuration = 120;

const STATUS: Record<StudioError["code"], number> = {
  no_dna: 409, quota_exceeded: 402, refused: 422, blocked: 422, invalid_output: 502, provider_error: 502, not_found: 404,
};

export async function POST(request: NextRequest) {
  const g = await guard("retouch", LIMITS.retouch);
  if ("response" in g) return g.response;
  const parsed = RetouchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid", parsed.error.issues[0]?.message ?? "Requête invalide");
  const b = parsed.data;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, artist_id").eq("id", b.projectId).maybeSingle();
  if (!project) return jsonError(404, "not_found", "Projet introuvable");
  const p = project as Pick<ProjectRow, "id" | "artist_id">;
  const [{ data: artist }, { data: dna }] = await Promise.all([
    supabase.from("artist_profiles").select("genres").eq("id", p.artist_id).single(),
    supabase.from("artist_dna").select("*").eq("artist_id", p.artist_id).eq("status", "ready").order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  try {
    const res = await retouchLines({
      userId: g.user.id,
      artistId: p.artist_id,
      projectId: p.id,
      action: b.action,
      song: b.song,
      sectionIndex: b.sectionIndex,
      lineIndexes: b.lineIndexes,
      keepRhyme: b.keepRhyme,
      explicit: b.explicit,
      syllableTarget: syllableTargetFor(artist as Pick<ArtistProfileRow, "genres">, dna as ArtistDnaRow | null, b.bpm),
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof StudioError) return jsonError(STATUS[e.code], e.code, e.message, e.details);
    return jsonError(500, "server_error", "Retouche impossible pour le moment.");
  }
}
