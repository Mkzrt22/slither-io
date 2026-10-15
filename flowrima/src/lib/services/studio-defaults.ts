import "server-only";
import { defaultStructure, type StudioDefaults } from "@/lib/studio-structure";
import type { ArtistDnaRow, ArtistProfileRow } from "@/lib/db/types";

/** Pre-fills the studio from the artist's DNA (structure, syllables, ideas, gimmicks). */
export function studioDefaults(artist: ArtistProfileRow, dna: ArtistDnaRow | null): StudioDefaults {
  const metrics = dna?.dna_json?.metrics;
  const llm = dna?.dna_json?.llm;
  return {
    genre: artist.genres[0] ?? "rap",
    languages: artist.languages.length ? artist.languages : ["fr"],
    explicit: artist.explicit_default,
    artistSyllables: metrics?.syllablesPerBar.avg ?? null,
    structure: defaultStructure(metrics?.structure.typicalSequence, metrics?.structure.avgCoupletBars, metrics?.structure.avgRefrainBars),
    inspirations: llm?.unexplored_themes ?? [],
    gimmicks: llm?.gimmicks ?? [],
  };
}
