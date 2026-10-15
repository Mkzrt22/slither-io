import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";
import { fetchTrackMetadata } from "@/lib/platforms/metadata";

export async function POST(request: NextRequest) {
  const g = await guard("metadata", LIMITS.metadata);
  if ("response" in g) return g.response;
  const body = z.object({ url: z.string().url().max(500) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_url", "Lien invalide.");
  const meta = await fetchTrackMetadata(body.data.url);
  if (!meta) return jsonError(422, "unsupported", "Lien non reconnu (Spotify, Deezer, YouTube, SoundCloud ou Apple Music).");
  return NextResponse.json(meta);
}
