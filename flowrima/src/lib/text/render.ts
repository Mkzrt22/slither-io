/**
 * Prepares lyrics for display: syllables per line, rhyme families (letters and
 * colours, shared across the whole song), ad-libs and breath markers as
 * separate segments. Pure, used by server and client components.
 */
import { analyzeRhymes, tokenizeLine } from "./rhymes";
import { countLineSyllables } from "./syllables";

export interface Segment {
  text: string;
  kind: "text" | "rhyme" | "adlib" | "breath";
  family?: string;
  colorIndex?: number; // 1..8
}

export interface RenderedLine {
  text: string;
  segments: Segment[];
  syllables: number;
  min: number;
  max: number;
  family: string | null;
  colorIndex: number | null;
  multi: number;
}

export interface RenderedSection {
  label: string;
  type?: string;
  flow?: { pace: string; notes: string };
  lines: RenderedLine[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const colorIndexOf = (letter: string) => (LETTERS.indexOf(letter[letter.length - 1]) % 8) + 1;

export function renderLine(line: string, tokenFamilies: Record<number, string>): Segment[] {
  const tokens = tokenizeLine(line);
  const segments: Segment[] = [];
  let cursor = 0;
  const pushText = (text: string) => {
    if (!text) return;
    // split out ad-libs "( … )" and breath markers " / "
    const parts = text.split(/(\([^)]*\)|\s\/\s|\/)/g).filter((p) => p !== "");
    for (const p of parts) {
      if (/^\(.*\)$/.test(p)) segments.push({ text: p, kind: "adlib" });
      else if (p.trim() === "/") segments.push({ text: p, kind: "breath" });
      else segments.push({ text: p, kind: "text" });
    }
  };
  tokens.forEach((t, i) => {
    const fam = tokenFamilies[i];
    if (!fam || t.isAdlib) return;
    pushText(line.slice(cursor, t.start));
    segments.push({ text: line.slice(t.start, t.end), kind: "rhyme", family: fam, colorIndex: colorIndexOf(fam) });
    cursor = t.end;
  });
  pushText(line.slice(cursor));
  return segments;
}

export function renderSections(
  sections: Array<{ label: string; type?: string; flow?: { pace: string; notes: string }; lines: string[] }>,
): RenderedSection[] {
  const all = sections.flatMap((s) => s.lines);
  const rh = analyzeRhymes(all);
  let k = 0;
  return sections.map((s) => ({
    label: s.label,
    type: s.type,
    flow: s.flow,
    lines: s.lines.map((text) => {
      const info = rh.lines[k++];
      const syl = countLineSyllables(text);
      return {
        text,
        segments: renderLine(text, info.tokenFamilies),
        syllables: syl.count,
        min: syl.min,
        max: syl.max,
        family: info.family,
        colorIndex: info.family ? colorIndexOf(info.family) : null,
        multi: info.multi,
      };
    }),
  }));
}
