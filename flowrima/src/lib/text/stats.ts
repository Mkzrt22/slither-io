/**
 * Vocabulary statistics: frequent words, signature words, richness, ad-libs.
 */
import { EN_STOPWORDS, EN_WORDS, FR_COMMON, FR_STOPWORDS } from "./lexicon";
import { splitAdlibs, tokenizeWords } from "./normalize";

export function contentWords(lines: string[]): string[] {
  return lines
    .flatMap((l) => tokenizeWords(splitAdlibs(l).main))
    .map((w) => w.replace(/^[a-z]'/, "")) // "l'amour" -> "amour", "j'rappe" -> "rappe"
    .filter((w) => w.length >= 3 && !FR_STOPWORDS.has(w) && !EN_STOPWORDS.has(w) && !/\d/.test(w));
}

export function frequencies(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

export function topN(freq: Map<string, number>, n: number): Array<[string, number]> {
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/**
 * Signature words: frequent in the artist's catalogue, spread over several
 * tracks, and not generic French. Score = occurrences × log2(1 + tracks).
 */
export function signatureWords(
  perTrack: Array<Map<string, number>>,
  n = 20,
): Array<{ word: string; count: number; tracks: number }> {
  const total = new Map<string, number>();
  const spread = new Map<string, number>();
  for (const freq of perTrack) {
    for (const [w, c] of freq) {
      total.set(w, (total.get(w) ?? 0) + c);
      spread.set(w, (spread.get(w) ?? 0) + 1);
    }
  }
  const minTracks = perTrack.length >= 3 ? 2 : 1;
  return [...total.entries()]
    .filter(([w, c]) => !FR_COMMON.has(w) && (spread.get(w) ?? 0) >= minTracks && c >= 2)
    .map(([word, count]) => ({ word, count, tracks: spread.get(word) ?? 0 }))
    .sort((a, b) => b.count * Math.log2(1 + b.tracks) - a.count * Math.log2(1 + a.tracks))
    .slice(0, n);
}

/** Moving-average type/token ratio (window 100) — robust to text length. */
export function vocabularyRichness(words: string[], window = 100): number {
  if (words.length === 0) return 0;
  if (words.length <= window) return new Set(words).size / words.length;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + window <= words.length; i += 25) {
    sum += new Set(words.slice(i, i + window)).size / window;
    count++;
  }
  return sum / count;
}

export function englishShare(lines: string[]): number {
  const words = lines.flatMap((l) => tokenizeWords(splitAdlibs(l).main));
  if (!words.length) return 0;
  return words.filter((w) => EN_WORDS.has(w)).length / words.length;
}

export function adlibFrequencies(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    for (const a of splitAdlibs(l).adlibs) {
      const k = a.toLowerCase().replace(/[!?.…]+$/g, "").trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
