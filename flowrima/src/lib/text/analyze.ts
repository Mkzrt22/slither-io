/**
 * Track-level and catalogue-level text analysis ("calculé par du code").
 * The output feeds:
 *  - track_analyses (structure_json, rhymes_json, syllables_json, stats_json)
 *  - the DNA prompt (measures the LLM must rely on)
 *  - the DNA page (stats de rimes et de flow)
 */
import { parseLyrics, type SectionType } from "./parse";
import { countLineSyllables } from "./syllables";
import { analyzeRhymes, schemeLabel } from "./rhymes";
import {
  adlibFrequencies, contentWords, englishShare, frequencies, mean, percentile, round,
  signatureWords, stdev, topN, vocabularyRichness,
} from "./stats";

export const ANALYZER_VERSION = "text-1.0.0";

export interface TrackTextAnalysis {
  version: string;
  language: "fr" | "en" | "mixed";
  englishShare: number;
  lineCount: number;
  wordCount: number;
  sections: Array<{ type: SectionType; label: string; bars: number; syllablesAvg: number }>;
  syllables: { perLine: number[]; avg: number; median: number; stdev: number; min: number; max: number };
  rhymes: {
    scheme: string;
    quatrains: Record<string, number>;
    rhymedLineRate: number;
    multiRate: number;
    internalPerLine: number;
    density: number;
    assonanceRate: number;
  };
  structure: {
    sequence: SectionType[];
    coupletBars: number[];
    refrainBars: number[];
    refrainCount: number;
    repetitionRate: number;
  };
  words: { top: Array<[string, number]>; richness: number; avgPerLine: number };
  adlibs: Array<[string, number]>;
}

export function analyzeTrackLyrics(lyrics: string): TrackTextAnalysis {
  const sections = parseLyrics(lyrics);
  const lines = sections.flatMap((s) => s.lines);
  const perLine = lines.map((l) => countLineSyllables(l).count);
  const sorted = [...perLine].sort((a, b) => a - b);
  const rh = analyzeRhymes(lines);
  const words = contentWords(lines);
  const en = englishShare(lines);

  const norm = (l: string) => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const lineCounts = frequencies(lines.map(norm));
  const repeatedLines = lines.filter((l) => (lineCounts.get(norm(l)) ?? 0) > 1).length;

  let offset = 0;
  const sectionStats = sections.map((s) => {
    const sylls = perLine.slice(offset, offset + s.lines.length);
    offset += s.lines.length;
    return { type: s.type, label: s.label, bars: s.lines.length, syllablesAvg: round(mean(sylls), 1) };
  });

  return {
    version: ANALYZER_VERSION,
    language: en > 0.6 ? "en" : en > 0.12 ? "mixed" : "fr",
    englishShare: round(en),
    lineCount: lines.length,
    wordCount: lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0),
    sections: sectionStats,
    syllables: {
      perLine,
      avg: round(mean(perLine), 1),
      median: percentile(sorted, 0.5),
      stdev: round(stdev(perLine), 1),
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    },
    rhymes: {
      scheme: rh.scheme,
      quatrains: rh.quatrains,
      rhymedLineRate: round(rh.rhymedLineRate),
      multiRate: round(rh.multiRate),
      internalPerLine: round(rh.internalPerLine),
      density: round(rh.density),
      assonanceRate: round(rh.assonanceRate),
    },
    structure: {
      sequence: sections.map((s) => s.type),
      coupletBars: sections.filter((s) => s.type === "couplet").map((s) => s.lines.length),
      refrainBars: sections.filter((s) => s.type === "refrain").map((s) => s.lines.length),
      refrainCount: sections.filter((s) => s.type === "refrain").length,
      repetitionRate: lines.length ? round(repeatedLines / lines.length) : 0,
    },
    words: {
      top: topN(frequencies(words), 15),
      richness: round(vocabularyRichness(words)),
      avgPerLine: lines.length ? round(words.length / lines.length, 1) : 0,
    },
    adlibs: topN(adlibFrequencies(lines), 10),
  };
}

// -----------------------------------------------------------------------------
// Catalogue aggregation
// -----------------------------------------------------------------------------

export interface CatalogTrackInput {
  id?: string;
  title: string;
  releaseDate?: string | null;
  lyrics: string;
  analysis?: TrackTextAnalysis;
}

export interface CatalogMetrics {
  analyzerVersion: string;
  trackCount: number;
  totalLines: number;
  reliability: number;
  syllablesPerBar: { avg: number; p25: number; p75: number; stdev: number };
  rhymes: {
    density: number;
    multiRate: number;
    internalPerLine: number;
    rhymedLineRate: number;
    assonanceRate: number;
    dominantPatterns: Array<{ pattern: string; label: string; share: number }>;
  };
  structure: {
    typicalSequence: SectionType[];
    avgCoupletBars: number;
    avgRefrainBars: number;
    refrainRepetitionRate: number;
  };
  vocabulary: {
    signatureWords: Array<{ word: string; count: number; tracks: number }>;
    topWords: Array<[string, number]>;
    richness: number;
    englishShare: number;
  };
  adlibs: Array<[string, number]>;
  timeline: Array<{
    title: string;
    releaseDate: string | null;
    syllablesAvg: number;
    density: number;
    multiRate: number;
    englishShare: number;
  }>;
}

/**
 * Reliability of the DNA (0–100) from the amount of material: 3 tracks ≈ 50,
 * 5 ≈ 70, 10 ≈ 90. Long tracks count a bit more than short ones.
 */
export function reliabilityScore(trackCount: number, totalLines: number): number {
  if (trackCount === 0) return 0;
  const byTracks = 1 - Math.exp(-trackCount / 4.2);
  const byLines = Math.min(1, 0.65 + totalLines / 600);
  return Math.round(100 * byTracks * byLines);
}

export function reliabilityLabel(score: number): "faible" | "correcte" | "bonne" | "excellente" {
  if (score < 50) return "faible";
  if (score < 75) return "correcte";
  if (score < 90) return "bonne";
  return "excellente";
}

function mostCommonSequence(seqs: SectionType[][]): SectionType[] {
  const counts = new Map<string, { seq: SectionType[]; n: number }>();
  for (const s of seqs) {
    // collapse consecutive duplicates (refrain, refrain)
    const collapsed = s.filter((x, i) => x !== s[i - 1]);
    const k = collapsed.join(">");
    counts.set(k, { seq: collapsed, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || b.seq.length - a.seq.length)[0]?.seq ?? [];
}

export function aggregateCatalog(tracks: CatalogTrackInput[]): CatalogMetrics {
  const analyses = tracks.map((t) => t.analysis ?? analyzeTrackLyrics(t.lyrics));
  const allLines = analyses.flatMap((a) => a.syllables.perLine);
  const sorted = [...allLines].sort((a, b) => a - b);
  const totalLines = allLines.length;
  const weight = (a: TrackTextAnalysis) => a.lineCount || 1;
  const wmean = (f: (a: TrackTextAnalysis) => number) => {
    const w = analyses.reduce((s, a) => s + weight(a), 0) || 1;
    return round(analyses.reduce((s, a) => s + f(a) * weight(a), 0) / w);
  };

  const patternCounts = new Map<string, number>();
  for (const a of analyses) {
    for (const [p, n] of Object.entries(a.rhymes.quatrains)) patternCounts.set(p, (patternCounts.get(p) ?? 0) + n);
  }
  const patternTotal = [...patternCounts.values()].reduce((a, b) => a + b, 0) || 1;

  const perTrackWords = tracks.map((t) => frequencies(contentWords(parseLyrics(t.lyrics).flatMap((s) => s.lines))));
  const allWords = new Map<string, number>();
  for (const f of perTrackWords) for (const [w, c] of f) allWords.set(w, (allWords.get(w) ?? 0) + c);
  const allAdlibs = new Map<string, number>();
  for (const a of analyses) for (const [k, c] of a.adlibs) allAdlibs.set(k, (allAdlibs.get(k) ?? 0) + c);

  const coupletBars = analyses.flatMap((a) => a.structure.coupletBars);
  const refrainBars = analyses.flatMap((a) => a.structure.refrainBars);

  const timeline = tracks
    .map((t, i) => ({
      title: t.title,
      releaseDate: t.releaseDate ?? null,
      syllablesAvg: analyses[i].syllables.avg,
      density: analyses[i].rhymes.density,
      multiRate: analyses[i].rhymes.multiRate,
      englishShare: analyses[i].englishShare,
    }))
    .sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""));

  return {
    analyzerVersion: ANALYZER_VERSION,
    trackCount: tracks.length,
    totalLines,
    reliability: reliabilityScore(tracks.length, totalLines),
    syllablesPerBar: {
      avg: round(mean(allLines), 1),
      p25: percentile(sorted, 0.25),
      p75: percentile(sorted, 0.75),
      stdev: round(stdev(allLines), 1),
    },
    rhymes: {
      density: wmean((a) => a.rhymes.density),
      multiRate: wmean((a) => a.rhymes.multiRate),
      internalPerLine: wmean((a) => a.rhymes.internalPerLine),
      rhymedLineRate: wmean((a) => a.rhymes.rhymedLineRate),
      assonanceRate: wmean((a) => a.rhymes.assonanceRate),
      dominantPatterns: [...patternCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([pattern, n]) => ({ pattern, label: schemeLabel(pattern), share: round(n / patternTotal) })),
    },
    structure: {
      typicalSequence: mostCommonSequence(analyses.map((a) => a.structure.sequence)),
      avgCoupletBars: Math.round(mean(coupletBars)) || 16,
      avgRefrainBars: Math.round(mean(refrainBars)) || 8,
      refrainRepetitionRate: wmean((a) => a.structure.repetitionRate),
    },
    vocabulary: {
      signatureWords: signatureWords(perTrackWords, 20),
      topWords: topN(allWords, 30),
      richness: wmean((a) => a.words.richness),
      englishShare: wmean((a) => a.englishShare),
    },
    adlibs: topN(allAdlibs, 12),
    timeline,
  };
}

/**
 * Picks 3–5 short, representative excerpts (2–4 lines) for the generation
 * prompt: the passages with the most signature words, from distinct tracks.
 * Deterministic so the cached prompt prefix stays byte-identical.
 */
export function pickReferenceExcerpts(
  tracks: CatalogTrackInput[],
  signature: string[],
  max = 5,
): Array<{ title: string; lines: string[] }> {
  const sig = new Set(signature);
  const candidates: Array<{ title: string; lines: string[]; score: number; order: number }> = [];
  tracks.forEach((t, ti) => {
    const sections = parseLyrics(t.lyrics).filter((s) => s.type === "couplet" || s.type === "refrain");
    for (const s of sections) {
      for (let i = 0; i + 4 <= s.lines.length; i += 4) {
        const chunk = s.lines.slice(i, i + 4);
        const words = contentWords(chunk);
        const score = words.filter((w) => sig.has(w)).length + new Set(words).size / 20;
        candidates.push({ title: t.title, lines: chunk, score, order: ti * 1000 + i });
      }
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  // First the best excerpt of each track, then fill with the next best ones.
  const picked: typeof candidates = [];
  const usedTitles = new Set<string>();
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!usedTitles.has(c.title)) {
      picked.push(c);
      usedTitles.add(c.title);
    }
  }
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.sort((a, b) => a.order - b.order).map(({ title, lines }) => ({ title, lines }));
}
