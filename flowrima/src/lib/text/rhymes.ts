/**
 * Rhyme engine: end rhymes, rhyme families (for colouring), schemes
 * (AABB, ABAB…), multisyllabic rhymes, internal rhymes, assonances and rhyme
 * density. Works on the phoneme strings produced by french-g2p.
 */
import { VOWEL_PHONEMES } from "./french-g2p";
import { EN_STOPWORDS, FR_STOPWORDS } from "./lexicon";
import { englishRime } from "./english";
import { numberToFrench } from "./normalize";
import { countWordSyllables, detectLineLang, type Lang } from "./syllables";

export interface Token {
  text: string;
  start: number;
  end: number;
  phonemes: string;
  syllables: number;
  lang: Lang;
  isAdlib: boolean;
}

/** Tokenises a line keeping character offsets (for colouring in the editor). */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const lang = detectLineLang(line);
  const adlibRanges: Array<[number, number]> = [];
  for (const m of line.matchAll(/\([^)]*\)/g)) adlibRanges.push([m.index!, m.index! + m[0].length]);
  for (const m of line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)) {
    const raw = m[0].replace(/’/g, "'");
    const start = m.index!;
    const isAdlib = adlibRanges.some(([a, b]) => start >= a && start < b);
    // Numbers are rapped as words: "93" -> "quatre vingt treize"
    const spoken = /^\d+$/.test(raw) ? numberToFrench(Number(raw)).split("-") : [raw];
    let phonemes = "";
    let syllables = 0;
    let wordLang: Lang = lang;
    for (const part of spoken) {
      const w = countWordSyllables(part, lang);
      syllables += w.count;
      wordLang = w.lang;
      phonemes += w.lang === "fr" ? w.phonemes : "";
    }
    tokens.push({ text: raw, start, end: start + m[0].length, phonemes, syllables, lang: wordLang, isAdlib });
  }
  return tokens;
}

const NORMALIZE_VOWEL: Record<string, string> = { E: "e", "@": "X" };
const normV = (v: string) => NORMALIZE_VOWEL[v] ?? v;

export interface RimeInfo {
  /** last stressed vowel + coda, e.g. "ER" for "galère" */
  rime: string;
  /** consonant just before the last vowel (rime riche) */
  onset: string;
  lastVowel: string;
  /** vowels of the ending, most recent last, schwas removed */
  skeleton: string[];
}

/** Rime of a phoneme string (final e muet removed, as it is not sung). */
export function rimeOfPhonemes(ph: string): RimeInfo | null {
  let p = ph;
  // drop the final schwa (and anything after it) when another vowel exists
  const vowelsCount = [...p].filter((c) => VOWEL_PHONEMES.has(c)).length;
  if (vowelsCount > 1) p = p.replace(/@[^aeEiouyX@AIO]*$/, (m) => m.slice(1));
  let idx = -1;
  for (let i = p.length - 1; i >= 0; i--) {
    if (VOWEL_PHONEMES.has(p[i]) && (p[i] !== "@" || vowelsCount === 1)) { idx = i; break; }
  }
  if (idx < 0) return null;
  const skeleton = [...p].filter((c) => VOWEL_PHONEMES.has(c) && c !== "@").map(normV);
  let onset = "";
  for (let j = idx - 1; j >= 0 && !VOWEL_PHONEMES.has(p[j]); j--) onset = p[j] + onset;
  return {
    rime: normV(p[idx]) + p.slice(idx + 1).replace(/[jwH]/g, (m) => m),
    onset: onset.replace(/[jwH]/g, ""),
    lastVowel: normV(p[idx]),
    skeleton,
  };
}

function rimeOfEnglishWord(word: string): RimeInfo {
  const r = englishRime(word);
  const vowel = r.match(/^[aeiouy]+/)?.[0] ?? r;
  return { rime: r, onset: "", lastVowel: vowel, skeleton: [vowel] };
}

/** Rime of the end of a line (looks at the last sung word). */
export function lineRime(tokens: Token[]): RimeInfo | null {
  const sung = tokens.filter((t) => !t.isAdlib);
  if (sung.length === 0) return null;
  const last = sung[sung.length - 1];
  if (last.lang === "en") return rimeOfEnglishWord(last.text);
  // Skeleton spans the last few words for multisyllabic detection
  const tail = sung.slice(-4).map((t) => t.phonemes).join("");
  const info = rimeOfPhonemes(tail);
  if (!info) return null;
  return info;
}

/**
 * 0 = no rhyme, 1 = assonance (same vowel), 2 = rime (vowel + coda),
 * 3 = rime riche (onset + vowel + coda).
 */
export function compareRimes(a: RimeInfo | null, b: RimeInfo | null): number {
  if (!a || !b) return 0;
  if (a.lastVowel !== b.lastVowel) return 0;
  if (a.rime !== b.rime) return 1;
  if (a.onset && a.onset.slice(-1) === b.onset.slice(-1)) return 3;
  return 2;
}

/** Number of matching vowels counted from the end (multisyllabic rhyme length). */
export function multisyllabicLength(a: RimeInfo | null, b: RimeInfo | null): number {
  if (!a || !b) return 0;
  let n = 0;
  const sa = a.skeleton;
  const sb = b.skeleton;
  while (n < sa.length && n < sb.length && sa[sa.length - 1 - n] === sb[sb.length - 1 - n]) n++;
  return n;
}

export interface LineRhymes {
  family: string | null;        // letter of the end-rhyme family (A, B, …)
  level: number;                // best match level with a previous line of the family
  multi: number;                // multisyllabic length (≥2 = multi)
  internal: number[];           // token indexes of internal rhymes
  tokenFamilies: Record<number, string>; // token index -> family (for colouring)
}

export interface RhymeAnalysis {
  lines: LineRhymes[];
  scheme: string;                       // e.g. "AABBCCDD"
  quatrains: Record<string, number>;    // normalised 4-line patterns -> count
  rhymedLineRate: number;               // share of lines that rhyme with another line
  multiRate: number;                    // share of rhyming lines with a ≥2-vowel multi
  internalPerLine: number;
  density: number;                      // rhyming syllables / sung syllables (0–1)
  assonanceRate: number;                // share of lines whose dominant vowel repeats ≥3 times
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const familyLetter = (n: number) => (n < 26 ? LETTERS[n] : `${LETTERS[Math.floor(n / 26) - 1]}${LETTERS[n % 26]}`);

export function normalizePattern(letters: string[]): string {
  const map = new Map<string, string>();
  return letters
    .map((l) => {
      if (l === "-") return "x";
      if (!map.has(l)) map.set(l, LETTERS[map.size]);
      return map.get(l)!;
    })
    .join("");
}

/**
 * Analyses the rhymes of a list of lines (one section or a full song).
 * Families are shared across the whole list so colours stay consistent.
 */
export function analyzeRhymes(lines: string[]): RhymeAnalysis {
  const toks = lines.map(tokenizeLine);
  const rimes = toks.map(lineRime);
  const families: Array<{ letter: string; members: number[] }> = [];
  const result: LineRhymes[] = lines.map(() => ({
    family: null, level: 0, multi: 0, internal: [], tokenFamilies: {},
  }));

  // ---- end-rhyme families (look back up to 8 lines) ------------------------
  const lineFamily: Array<number | null> = lines.map(() => null);
  // Pass 1 links true rhymes (vowel + coda); pass 2 lets the remaining lines
  // join through assonance only. Without this, chains of assonances ("hiver",
  // "tête", "année" all end on an /e/-like vowel) would merge distinct families.
  for (const threshold of [2, 1]) {
    for (let i = 0; i < lines.length; i++) {
      if (!rimes[i] || lineFamily[i] !== null) continue;
      let best: { j: number; level: number; multi: number } | null = null;
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const level = compareRimes(rimes[i], rimes[j]);
        if (level >= threshold && level > (best?.level ?? 0)) {
          best = { j, level, multi: multisyllabicLength(rimes[i], rimes[j]) };
        }
      }
      // forward look-up so that the first line of a pair also gets its family
      if (!best) {
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 8); j++) {
          const level = compareRimes(rimes[i], rimes[j]);
          if (level >= threshold && level > (best?.level ?? 0) && lineFamily[j] !== null) {
            best = { j, level, multi: multisyllabicLength(rimes[i], rimes[j]) };
          }
        }
      }
      if (!best) continue;
      let fam = lineFamily[best.j];
      if (fam === null) {
        families.push({ letter: "", members: [best.j] });
        fam = families.length - 1;
        lineFamily[best.j] = fam;
      }
      if (result[best.j].level < best.level) result[best.j].level = best.level;
      result[best.j].multi = Math.max(result[best.j].multi, best.multi);
      lineFamily[i] = fam;
      families[fam].members.push(i);
      result[i].level = best.level;
      result[i].multi = best.multi;
    }
  }
  // Letters follow the order of first appearance in the text
  families
    .map((f, idx) => ({ idx, first: Math.min(...f.members) }))
    .sort((a, b) => a.first - b.first)
    .forEach(({ idx }, rank) => (families[idx].letter = familyLetter(rank)));

  // Lines without a partner get their own (singleton) letter for the scheme
  const schemeLetters: string[] = [];
  let extra = families.length; // singleton letters come after family letters
  for (let i = 0; i < lines.length; i++) {
    const f = lineFamily[i];
    if (f !== null) {
      result[i].family = families[f].letter;
      schemeLetters.push(families[f].letter);
    } else if (rimes[i]) {
      schemeLetters.push(familyLetter(extra++));
    } else {
      schemeLetters.push("-");
    }
  }

  // ---- token colouring + internal rhymes ------------------------------------
  const familyRimes = families.map((f) => rimes[f.members[0]]!);
  let internalCount = 0;
  let rhymingSyllables = 0;
  let sungSyllables = 0;
  let assonantLines = 0;
  toks.forEach((tokens, i) => {
    const sung = tokens.map((t, k) => ({ t, k })).filter(({ t }) => !t.isAdlib);
    sungSyllables += sung.reduce((s, { t }) => s + t.syllables, 0);
    const last = sung[sung.length - 1];
    if (last && result[i].family) {
      result[i].tokenFamilies[last.k] = result[i].family!;
      rhymingSyllables += Math.max(1, Math.min(result[i].multi, last.t.syllables + 2));
    }
    const vowelCounts = new Map<string, number>();
    sung.forEach(({ t, k }, idx) => {
      for (const ph of t.phonemes) if (VOWEL_PHONEMES.has(ph) && ph !== "@") {
        vowelCounts.set(normV(ph), (vowelCounts.get(normV(ph)) ?? 0) + 1);
      }
      if (idx === sung.length - 1 || t.syllables === 0) return;
      const lower = t.text.toLowerCase();
      // "j'ai", "c'est", "qu'il": judge the word after the elision, not the clitic.
      const core = lower.replace(/^[a-zà-ÿ]{1,3}['’]/, "");
      if ([lower, core].some((w) => FR_STOPWORDS.has(w) || EN_STOPWORDS.has(w)) || core.length < 3) return;
      const r = t.lang === "en" ? rimeOfEnglishWord(t.text) : rimeOfPhonemes(t.phonemes);
      if (!r) return;
      // internal rhyme with a known family, or with another word of the line
      const famIdx = familyRimes.findIndex((fr) => compareRimes(r, fr) >= 2);
      const sameLine = sung.some(
        (o, oIdx) => oIdx !== idx && o.t.text.toLowerCase() !== t.text.toLowerCase() &&
          compareRimes(r, o.t.lang === "en" ? rimeOfEnglishWord(o.t.text) : rimeOfPhonemes(o.t.phonemes)) >= 2,
      );
      if (famIdx >= 0 || sameLine) {
        result[i].internal.push(k);
        internalCount++;
        rhymingSyllables += 1;
        if (famIdx >= 0) result[i].tokenFamilies[k] = families[famIdx].letter;
      }
    });
    if ([...vowelCounts.values()].some((n) => n >= 3)) assonantLines++;
  });

  // ---- schemes ---------------------------------------------------------------
  const quatrains: Record<string, number> = {};
  for (let i = 0; i + 4 <= schemeLetters.length; i += 4) {
    const pattern = normalizePattern(schemeLetters.slice(i, i + 4));
    quatrains[pattern] = (quatrains[pattern] ?? 0) + 1;
  }

  const rhymed = result.filter((r) => r.family).length;
  const withRime = rimes.filter(Boolean).length || 1;
  return {
    lines: result,
    scheme: schemeLetters.join(""),
    quatrains,
    rhymedLineRate: rhymed / withRime,
    multiRate: rhymed ? result.filter((r) => r.multi >= 2).length / rhymed : 0,
    internalPerLine: lines.length ? internalCount / lines.length : 0,
    density: sungSyllables ? Math.min(1, rhymingSyllables / sungSyllables) : 0,
    assonanceRate: lines.length ? assonantLines / lines.length : 0,
  };
}

/** Human label of a normalised quatrain pattern. */
export function schemeLabel(pattern: string): string {
  switch (pattern) {
    case "AAAA": return "rimes suivies (monorime)";
    case "AABB": return "rimes plates (AABB)";
    case "ABAB": return "rimes croisées (ABAB)";
    case "ABBA": return "rimes embrassées (ABBA)";
    default: return pattern;
  }
}
