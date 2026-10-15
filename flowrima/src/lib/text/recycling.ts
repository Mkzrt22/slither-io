/**
 * Anti-recycling: a generated line must never contain more than 4 consecutive
 * words identical to a line of the artist's catalogue (unless it is a
 * signature gimmick the artist explicitly asked for). We also flag near
 * duplicates (same line with small changes) with a character-trigram
 * similarity — a lexical proxy for semantic similarity until phase 2 adds
 * embeddings.
 */
import { canonicalTokens } from "./normalize";

export const MAX_SHARED_WORDS = 4;
const N = MAX_SHARED_WORDS + 1; // forbidden n-gram length

export interface CatalogLine {
  trackTitle: string;
  line: string;
}

export interface CatalogIndex {
  ngrams: Map<string, CatalogLine>;
  lines: Array<CatalogLine & { trigrams: Set<string>; tokenCount: number }>;
}

export interface RecyclingViolation {
  lineIndex: number;
  line: string;
  type: "ngram" | "near_duplicate";
  matched: string;
  source: CatalogLine;
  similarity?: number;
}

function ngrams(tokens: string[], n = N): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

function trigrams(text: string): Set<string> {
  const s = ` ${text} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function buildCatalogIndex(tracks: Array<{ title: string; lines: string[] }>): CatalogIndex {
  const index: CatalogIndex = { ngrams: new Map(), lines: [] };
  for (const t of tracks) {
    for (const line of t.lines) {
      const tokens = canonicalTokens(line);
      if (!tokens.length) continue;
      const entry = { trackTitle: t.title, line };
      for (const g of ngrams(tokens)) if (!index.ngrams.has(g)) index.ngrams.set(g, entry);
      index.lines.push({ ...entry, trigrams: trigrams(tokens.join(" ")), tokenCount: tokens.length });
    }
  }
  return index;
}

export interface RecyclingOptions {
  /** Signature gimmicks explicitly requested: their n-grams are allowed. */
  allowed?: string[];
  nearDuplicateThreshold?: number;
}

export function checkRecycling(
  lines: string[],
  index: CatalogIndex,
  opts: RecyclingOptions = {},
): RecyclingViolation[] {
  const threshold = opts.nearDuplicateThreshold ?? 0.72;
  const allowed = new Set((opts.allowed ?? []).flatMap((g) => ngrams(canonicalTokens(g))));
  const violations: RecyclingViolation[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = canonicalTokens(line);
    if (!tokens.length) return;
    for (const g of ngrams(tokens)) {
      if (allowed.has(g)) continue;
      const source = index.ngrams.get(g);
      if (source) {
        violations.push({ lineIndex, line, type: "ngram", matched: g, source });
        return; // one violation per line is enough to trigger a rewrite
      }
    }
    if (tokens.length < 4) return;
    const tri = trigrams(tokens.join(" "));
    let best: { sim: number; src: CatalogIndex["lines"][number] } | null = null;
    for (const cl of index.lines) {
      if (Math.abs(cl.tokenCount - tokens.length) > Math.max(3, tokens.length * 0.5)) continue;
      const sim = jaccard(tri, cl.trigrams);
      if (sim >= threshold && sim > (best?.sim ?? 0)) best = { sim, src: cl };
    }
    if (best) {
      violations.push({
        lineIndex, line, type: "near_duplicate", matched: best.src.line,
        source: { trackTitle: best.src.trackTitle, line: best.src.line },
        similarity: Math.round(best.sim * 100) / 100,
      });
    }
  });
  return violations;
}

/** Longest run of consecutive shared words between two lines (for reports/tests). */
export function longestSharedRun(a: string, b: string): number {
  const ta = canonicalTokens(a);
  const tb = canonicalTokens(b);
  let best = 0;
  for (let i = 0; i < ta.length; i++) {
    for (let j = 0; j < tb.length; j++) {
      let k = 0;
      while (i + k < ta.length && j + k < tb.length && ta[i + k] === tb[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}
