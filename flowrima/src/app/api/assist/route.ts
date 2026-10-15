import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";
import { getActiveArtist } from "@/lib/auth";
import { aiAssist, StudioError } from "@/lib/services/studio";

export const maxDuration = 60;

/** Contextual AI rhymes / synonyms / line endings (counts towards the "assist" quota). */
export async function POST(request: NextRequest) {
  const g = await guard("assist", LIMITS.assist);
  if ("response" in g) return g.response;
  const body = z
    .object({
      word: z.string().trim().min(1).max(40),
      line: z.string().trim().max(300),
      projectId: z.string().uuid().nullable().optional(),
      explicit: z.boolean().default(false),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid", "Requête invalide");
  const artist = await getActiveArtist();
  if (!artist) return jsonError(409, "no_artist", "Crée d'abord ton profil artiste.");
  try {
    const res = await aiAssist({ userId: g.user.id, artistId: artist.id, projectId: body.data.projectId ?? null, ...body.data });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof StudioError) return jsonError(e.code === "quota_exceeded" ? 402 : 422, e.code, e.message, e.details);
    return jsonError(500, "server_error", "Suggestions indisponibles.");
  }
}
