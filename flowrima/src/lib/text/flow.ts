/**
 * Flow helpers: syllable targets per bar from BPM, bar grid and timing.
 * 4/4 time is assumed (one lyric line = one bar, the convention used by the
 * generator and the editor's bar grid).
 */

export type Genre = "rap" | "trap" | "drill" | "rnb" | "pop_urbaine" | "afro" | "variete";

export const GENRES: Array<{ id: Genre; label: string }> = [
  { id: "rap", label: "Rap" },
  { id: "trap", label: "Trap" },
  { id: "drill", label: "Drill" },
  { id: "rnb", label: "R&B" },
  { id: "pop_urbaine", label: "Pop urbaine" },
  { id: "afro", label: "Afro" },
  { id: "variete", label: "Variété" },
];

/** Typical density (syllables per bar) at a reference tempo, by genre. */
const GENRE_PROFILE: Record<Genre, { syllables: number; refBpm: number; min: number; max: number }> = {
  rap: { syllables: 12, refBpm: 92, min: 8, max: 18 },
  trap: { syllables: 11, refBpm: 140, min: 7, max: 16 },
  drill: { syllables: 11, refBpm: 142, min: 8, max: 16 },
  rnb: { syllables: 8, refBpm: 80, min: 5, max: 12 },
  pop_urbaine: { syllables: 9, refBpm: 105, min: 6, max: 13 },
  afro: { syllables: 9, refBpm: 108, min: 6, max: 13 },
  variete: { syllables: 8, refBpm: 110, min: 5, max: 12 },
};

export interface SyllableTarget {
  target: number;
  min: number;
  max: number;
  source: "artist" | "genre" | "artist+bpm" | "genre+bpm";
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * Target syllables per bar (±2 tolerance is applied by the generator).
 * - The artist's own measured average is the best prior.
 * - When a reference beat BPM is given, density is scaled inversely to tempo
 *   (a faster beat leaves less room per bar), within ±30 %.
 */
export function targetSyllablesPerBar(opts: {
  genre?: Genre | string | null;
  bpm?: number | null;
  artistAvg?: number | null;
  artistBpm?: number | null;
}): SyllableTarget {
  const profile = GENRE_PROFILE[(opts.genre as Genre) ?? "rap"] ?? GENRE_PROFILE.rap;
  let base = profile.syllables;
  let refBpm = profile.refBpm;
  let source: SyllableTarget["source"] = "genre";
  if (opts.artistAvg && opts.artistAvg > 3) {
    base = 0.7 * opts.artistAvg + 0.3 * profile.syllables;
    source = "artist";
    if (opts.artistBpm) refBpm = opts.artistBpm;
  }
  if (opts.bpm && opts.bpm > 40) {
    // Half-time feel: a 70 BPM reference and a 140 BPM beat are the same pocket.
    let bpm = opts.bpm;
    if (bpm / refBpm > 1.6) bpm /= 2;
    if (refBpm / bpm > 1.6) bpm *= 2;
    base *= clamp(refBpm / bpm, 0.7, 1.3);
    source = source === "artist" ? "artist+bpm" : "genre+bpm";
  }
  const target = Math.round(clamp(base, profile.min, profile.max));
  return { target, min: Math.max(3, target - 2), max: target + 2, source };
}

/** Duration of one 4/4 bar in seconds. */
/**
 * The per-bar syllable target only makes sense for verses (and bridges): hooks
 * and intros are deliberately sparser or chanted, flagging them would be noise.
 * Sections without a known type (pasted text) keep the target.
 */
export function sectionUsesTarget(type?: string | null): boolean {
  return !type || type === "couplet" || type === "pont";
}

export function barSeconds(bpm: number): number {
  return 240 / bpm;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Start/end time of each section (structure minutée for the PDF). */
export function sectionTimings(
  sections: Array<{ label: string; bars: number }>,
  bpm: number,
  introBars = 0,
): Array<{ label: string; bars: number; start: string; end: string }> {
  const bar = barSeconds(bpm);
  let t = introBars * bar;
  return sections.map((s) => {
    const start = t;
    t += s.bars * bar;
    return { label: s.label, bars: s.bars, start: formatTime(start), end: formatTime(t) };
  });
}
