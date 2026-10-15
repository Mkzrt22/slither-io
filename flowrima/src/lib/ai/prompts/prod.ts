/**
 * Prompt 7.3 — « Prod » (phase 3). Turns the audio DNA and the artist's
 * choices into a text prompt for the music provider. Pure function: no LLM
 * call needed, and never any artist name (provider terms + copyright).
 */

export interface AudioDna {
  bpm?: number | null;
  musicalKey?: string | null;
  mode?: "major" | "minor" | null;
  subgenre?: string | null;
  instruments?: string[];
  moods?: string[];
  energy?: number | null; // 0–1
}

export interface ProdChoices {
  genre?: string;
  mood?: string;
  bpm?: number;
  musicalKey?: string;
  structure?: string; // e.g. "intro 4, couplet 16, refrain 8…"
  extraInstruments?: string[];
  avoid?: string[];
  durationSeconds?: number;
  referenceDescription?: string; // free text, artist names are stripped
}

/** Removes "like <Artist>", "type beat <Artist>" fragments: references are described, not named. */
export function stripArtistReferences(text: string): string {
  return text
    .replace(/\b(?:type\s*beat|style|comme|like|à la)\s+[A-Z][\w'.&-]*(?:\s+[A-Z][\w'.&-]*)*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildProdPrompt(dna: AudioDna, choices: ProdChoices = {}): string {
  const bpm = choices.bpm ?? dna.bpm ?? undefined;
  const key = choices.musicalKey ?? (dna.musicalKey ? `${dna.musicalKey} ${dna.mode === "minor" ? "minor" : dna.mode === "major" ? "major" : ""}`.trim() : undefined);
  const energy =
    dna.energy == null ? undefined : dna.energy > 0.7 ? "high energy" : dna.energy > 0.4 ? "medium energy" : "laid-back, low energy";
  const instruments = [...(dna.instruments ?? []), ...(choices.extraInstruments ?? [])];
  const parts = [
    `Instrumental ${choices.genre ?? dna.subgenre ?? "hip-hop"} beat, no vocals`,
    bpm ? `${Math.round(bpm)} BPM` : undefined,
    key ? `key of ${key}` : undefined,
    [choices.mood, ...(dna.moods ?? [])].filter(Boolean).join(", ") || undefined,
    energy,
    instruments.length ? `instrumentation: ${[...new Set(instruments)].join(", ")}` : undefined,
    choices.structure ? `structure: ${choices.structure}` : "structure: intro, verse, hook, verse, hook, outro",
    choices.referenceDescription ? `atmosphere: ${stripArtistReferences(choices.referenceDescription)}` : undefined,
    choices.avoid?.length ? `avoid: ${choices.avoid.join(", ")}` : undefined,
    "mix leaves space for a lead vocal, modern and clean master",
  ];
  return parts.filter(Boolean).join(". ") + ".";
}
