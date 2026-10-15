import type { NextRequest } from "next/server";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { GenerateBody } from "@/lib/studio-schemas";
import { generateLyrics, StudioError } from "@/lib/services/studio";
import { syllableTargetFor } from "@/lib/services/targets";
import type { ArtistDnaRow, ArtistProfileRow, ProjectRow } from "@/lib/db/types";

// A full generation (3 songs, effort "medium") can take 1–3 minutes.
export const maxDuration = 300;

/**
 * Streams the generation as NDJSON events:
 *   {"type":"delta","text":"…"}  raw JSON text of the proposals, as written
 *   {"type":"done", …}           saved versions (after the anti-recycling pass)
 *   {"type":"error","code":"…","message":"…"}
 */
export async function POST(request: NextRequest) {
  const g = await guard("generate", LIMITS.generate);
  if ("response" in g) return g.response;
  const parsed = GenerateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid", parsed.error.issues[0]?.message ?? "Requête invalide");
  const { projectId, params } = parsed.data;

  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, artist_id, title").eq("id", projectId).maybeSingle();
  if (!project) return jsonError(404, "not_found", "Projet introuvable");
  const p = project as Pick<ProjectRow, "id" | "artist_id" | "title">;
  const [{ data: artist }, { data: dna }] = await Promise.all([
    supabase.from("artist_profiles").select("id, genres").eq("id", p.artist_id).single(),
    supabase.from("artist_dna").select("*").eq("artist_id", p.artist_id).eq("status", "ready").order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const syllableTarget = syllableTargetFor(artist as Pick<ArtistProfileRow, "genres">, dna as ArtistDnaRow | null, params.bpm);
  if (params.bpm || params.musicalKey) {
    await supabase.from("projects").update({ bpm: params.bpm ?? null, musical_key: params.musicalKey ?? null }).eq("id", p.id);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      // Keep the connection alive while the model thinks (adaptive thinking runs before text).
      const keepAlive = setInterval(() => send({ type: "ping" }), 10_000);
      try {
        send({ type: "start", syllableTarget });
        const result = await generateLyrics({
          userId: g.user.id,
          artistId: p.artist_id,
          projectId: p.id,
          params: { ...params, syllableTarget },
          onDelta: (text) => send({ type: "delta", text }),
          signal: request.signal,
        });
        send({ type: "done", ...result });
      } catch (e) {
        if (e instanceof StudioError) send({ type: "error", code: e.code, message: e.message, ...e.details });
        else send({ type: "error", code: "server_error", message: "La génération a échoué, réessaie." });
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
