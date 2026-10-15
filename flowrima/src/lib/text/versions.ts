import { sectionsToText } from "./parse";
import { canonicalTokens } from "./normalize";

interface Content {
  sections: Array<{ label: string; lines: string[] }>;
}

export function contentToTextSafe(c: Content): string {
  return sectionsToText(c.sections).slice(0, 30000);
}

/**
 * Share of the artist's lines that differ from the AI proposal they started
 * from (0 = untouched AI text, 1 = fully rewritten). Shown to encourage the
 * human creative contribution required for copyright / SACEM.
 */
export function humanEditRatio(original: Content, edited: Content): number {
  const key = (l: string) => canonicalTokens(l).join(" ");
  const before = new Set(original.sections.flatMap((s) => s.lines).map(key));
  const after = edited.sections.flatMap((s) => s.lines).map(key).filter(Boolean);
  if (!after.length) return 0;
  const changed = after.filter((l) => !before.has(l)).length;
  return Math.round((changed / after.length) * 1000) / 1000;
}
