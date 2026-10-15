/**
 * Splits raw lyrics into sections ([Couplet 1], [Refrain]…). Accepts the
 * common notations: "[Refrain]", "(Refrain)", "Refrain :", "[Couplet 2 : feat]",
 * English tags ("[Verse]", "[Chorus]", "[Hook]"). Without tags, stanzas are
 * separated by blank lines and repeated stanzas are considered refrains.
 */

export type SectionType =
  | "intro" | "couplet" | "pre_refrain" | "refrain" | "pont" | "outro" | "interlude";

export interface ParsedSection {
  type: SectionType;
  label: string;
  lines: string[];
}

export const SECTION_LABELS: Record<SectionType, string> = {
  intro: "Intro",
  couplet: "Couplet",
  pre_refrain: "Pré-refrain",
  refrain: "Refrain",
  pont: "Pont",
  outro: "Outro",
  interlude: "Interlude",
};

const KEYWORDS =
  "intro|couplet|verse|refrain|chorus|hook|pont|bridge|pr[ée][- ]?(?:refrain|chorus|hook)|outro|interlude|break|post[- ]?(?:refrain|chorus)";
// "[Couplet 2 : feat]" / "(Refrain)" — bracketed
const BRACKETED_RE = new RegExp(`^\\s*[[(]\\s*(${KEYWORDS})\\b([^\\])]*)[\\])]\\s*$`, "i");
// "Refrain :" / "Couplet 2 : Booba" — keyword + optional number + colon
const COLON_RE = new RegExp(`^\\s*(${KEYWORDS})(\\s*\\d+)?\\s*:.*$`, "i");
// "Refrain" / "Couplet 1" alone on the line
const BARE_RE = new RegExp(`^\\s*(${KEYWORDS})(\\s*\\d+)?\\s*$`, "i");

function headerType(word: string): SectionType {
  const w = word.toLowerCase().replace(/é/g, "e");
  if (w.startsWith("pre") || w.startsWith("post")) return "pre_refrain";
  if (w === "intro") return "intro";
  if (w === "couplet" || w === "verse") return "couplet";
  if (w === "refrain" || w === "chorus" || w === "hook") return "refrain";
  if (w === "pont" || w === "bridge") return "pont";
  if (w === "outro") return "outro";
  return "interlude";
}

export function parseSectionHeader(line: string): { type: SectionType; label: string } | null {
  const m = line.match(BRACKETED_RE) ?? line.match(COLON_RE) ?? line.match(BARE_RE);
  if (!m) return null;
  const type = headerType(m[1]);
  const num = m[2]?.match(/\d+/)?.[0];
  return { type, label: num ? `${SECTION_LABELS[type]} ${num}` : SECTION_LABELS[type] };
}

const normKey = (lines: string[]) =>
  lines.map((l) => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")).join("|");

export function parseLyrics(text: string): ParsedSection[] {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  const hasHeaders = rawLines.some((l) => parseSectionHeader(l));

  if (hasHeaders) {
    const sections: ParsedSection[] = [];
    let current: ParsedSection | null = null;
    for (const raw of rawLines) {
      const header = parseSectionHeader(raw);
      if (header) {
        current = { ...header, lines: [] };
        sections.push(current);
        continue;
      }
      const line = raw.trim();
      if (!line) continue;
      if (!current) {
        current = { type: "intro", label: "Intro", lines: [] };
        sections.push(current);
      }
      current.lines.push(line);
    }
    return numberCouplets(sections.filter((s) => s.lines.length > 0));
  }

  // No headers: stanzas separated by blank lines
  const stanzas: string[][] = [];
  let buf: string[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) {
      if (buf.length) stanzas.push(buf);
      buf = [];
    } else buf.push(line);
  }
  if (buf.length) stanzas.push(buf);

  const counts = new Map<string, number>();
  for (const s of stanzas) counts.set(normKey(s), (counts.get(normKey(s)) ?? 0) + 1);

  const sections: ParsedSection[] = stanzas.map((lines, i) => {
    const repeated = (counts.get(normKey(lines)) ?? 0) > 1;
    if (repeated) return { type: "refrain", label: "Refrain", lines };
    if (i === stanzas.length - 1 && stanzas.length > 2 && lines.length <= 4)
      return { type: "outro", label: "Outro", lines };
    if (i === 0 && stanzas.length > 2 && lines.length <= 2)
      return { type: "intro", label: "Intro", lines };
    return { type: "couplet", label: "Couplet", lines };
  });
  return numberCouplets(sections);
}

function numberCouplets(sections: ParsedSection[]): ParsedSection[] {
  let n = 0;
  return sections.map((s) => {
    if (s.type !== "couplet") return s;
    n++;
    return /\d/.test(s.label) ? s : { ...s, label: `Couplet ${n}` };
  });
}

/** Serialises sections back to tagged lyrics. */
export function sectionsToText(sections: Array<{ label: string; lines: string[] }>): string {
  return sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n");
}
