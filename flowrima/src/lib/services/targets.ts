import "server-only";
import { targetSyllablesPerBar } from "@/lib/text/flow";
import type { ArtistDnaRow, ArtistProfileRow } from "@/lib/db/types";

/** Syllable target for an artist (measured DNA + reference BPM). */
export function syllableTargetFor(artist: Pick<ArtistProfileRow, "genres">, dna: ArtistDnaRow | null, bpm?: number | null) {
  const metrics = dna?.dna_json?.metrics;
  return targetSyllablesPerBar({
    genre: artist.genres[0] ?? "rap",
    bpm: bpm ?? null,
    artistAvg: metrics?.syllablesPerBar.avg ?? null,
    artistBpm: null,
  });
}
