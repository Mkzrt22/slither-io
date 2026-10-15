/**
 * Text normalisation helpers shared by the syllable counter, the rhyme engine
 * and the anti-recycling check. Pure functions, safe on server and client.
 */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
];
const TENS: Record<number, string> = {
  2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante",
};

function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7) return n === 71 ? "soixante-et-onze" : `soixante-${below100(n - 60)}`;
  if (t === 8) return u === 0 ? "quatre-vingts" : `quatre-vingt-${UNITS[u]}`;
  if (t === 9) return `quatre-vingt-${below100(n - 80)}`;
  if (u === 0) return TENS[t];
  if (u === 1) return `${TENS[t]}-et-un`;
  return `${TENS[t]}-${UNITS[u]}`;
}

/** Spells out an integer (0–9999) in French, as it would be rapped. */
export function numberToFrench(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 100) return below100(n);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const head = h === 1 ? "cent" : `${UNITS[h]}-cent${rest === 0 ? "s" : ""}`;
    return rest === 0 ? head : `${head}-${below100(rest)}`;
  }
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = th === 1 ? "mille" : `${numberToFrench(th)}-mille`;
  return rest === 0 ? head : `${head}-${numberToFrench(rest)}`;
}

const SYMBOLS: Array<[RegExp, string]> = [
  [/&/g, " et "],
  [/%/g, " pour cent "],
  [/€/g, " euros "],
  [/\$/g, " dollars "],
  [/\+/g, " plus "],
  [/@/g, " at "],
];

/**
 * Splits a lyric line into its sung text and its ad-libs.
 * Convention (same as the generation prompt): ad-libs are between parentheses.
 */
export function splitAdlibs(line: string): { main: string; adlibs: string[] } {
  const adlibs: string[] = [];
  const main = line
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const t = inner.trim();
      if (t) adlibs.push(t);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { main, adlibs };
}

/**
 * Words of a line, lower-cased, with numbers spelled out and elisions kept
 * attached to the following word ("j'suis" -> ["j'suis"]). Breath markers
 * ("/") and punctuation are removed.
 */
export function tokenizeWords(text: string): string[] {
  let t = text.toLowerCase().replace(/[’`´]/g, "'");
  for (const [re, rep] of SYMBOLS) t = t.replace(re, rep);
  t = t.replace(/\d+/g, (d) => ` ${numberToFrench(Number(d)).replace(/-/g, " ")} `);
  return t
    .split(/[\s\/\-–—_.,;:!?¡¿"«»“”()[\]{}…*~|]+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => /\p{L}/u.test(w));
}

/** Removes diacritics (for loose comparisons only — never for phonetics). */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Canonical token list for n-gram comparisons: accents, apostrophes and
 * punctuation removed, so that trivial spelling variants of the same line
 * still match.
 */
export function canonicalTokens(text: string): string[] {
  // Elided words stay one word ("j'ai" -> "jai"): the rule is about *words*.
  return tokenizeWords(splitAdlibs(text).main)
    .map((w) => stripAccents(w).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}
