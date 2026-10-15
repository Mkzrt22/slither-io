import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";
import { getActiveArtist } from "@/lib/auth";
import { localRhymes } from "@/lib/services/studio";

/** Offline rhyme dictionary (free, no quota): artist vocabulary first. */
export async function GET(request: NextRequest) {
  const g = await guard("rhymes", LIMITS.assist);
  if ("response" in g) return g.response;
  const word = request.nextUrl.searchParams.get("word")?.trim().toLowerCase() ?? "";
  if (!/^[\p{L}'’-]{1,40}$/u.test(word)) return jsonError(400, "invalid", "Mot invalide");
  const artist = await getActiveArtist();
  return NextResponse.json({ word, rhymes: await localRhymes(g.user.id, artist?.id ?? null, word) });
}
