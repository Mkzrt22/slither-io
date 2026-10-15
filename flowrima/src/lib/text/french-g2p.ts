/**
 * Rule-based French grapheme-to-phoneme converter, tuned for rap / song lyrics
 * (spoken French, synérèse, e muet). It powers syllable counting and rhyme
 * detection without any external service, so it runs in the browser too
 * (live counters in the editor).
 *
 * It is an approximation: phase 2 adds espeak-ng / phonemizer in the Python
 * audio service for the catalogue analysis. The editor keeps this fast path.
 *
 * Phoneme alphabet (one character per phoneme):
 *   vowels      a e(é) E(è) i o u(ou) y(u) X(eu) @(e muet) A(an) I(in/un) O(on)
 *   semivowels  j w H(ɥ as in "nuit")
 *   consonants  p b t d k g f v s z S(ch) Z(j) m n G(gn) l R
 */

import {
  ES_AS_E,
  PRONOUNCED_ENT,
  PRONOUNCED_ER,
  SCHWA_MONOSYLLABLES,
  VERBS_ENDING_IN_MENT,
} from "./lexicon";

export const VOWEL_PHONEMES = new Set(["a", "e", "E", "i", "o", "u", "y", "X", "@", "A", "I", "O"]);

const LETTER_VOWELS = "aeiouyàâäéèêëîïôöùûüÿœæ";
const isVowelLetter = (c: string | undefined) => !!c && LETTER_VOWELS.includes(c);
const FRONT = "eiyéèêëîï"; // letters that soften c/g

/** Hand-checked transcriptions for frequent irregular words. */
const G2P_OVERRIDES: Record<string, string> = {
  fille: "fij@", filles: "fij@", ville: "vil@", villes: "vil@", mille: "mil@",
  tranquille: "tRAkil@", femme: "fam@", femmes: "fam@", monsieur: "m@sjX",
  oignon: "oGO", second: "s@gO", seconde: "s@gOd@", pays: "pEi", christ: "kRist",
  sept: "sEt", huit: "Hit", dix: "dis", six: "sis", os: "os", fils: "fis", sens: "sAs",
  plus: "plys", tous: "tus", jamais: "ZamE", mais: "mE", est: "E", et: "e", es: "E",
  eu: "y", eus: "y", eut: "y", oui: "wi", ouais: "wE", wesh: "wES", yeah: "jE",
  hein: "I", eh: "E", oh: "o", ah: "a", gars: "ga", taf: "taf", bled: "blEd",
  net: "nEt", but: "byt", ouest: "wEst", zut: "zyt", chut: "Syt", foot: "fut",
  temps: "tA", corps: "koR", trop: "tRo", beaucoup: "boku", coup: "ku", coups: "ku",
  loup: "lu", champ: "SA", camp: "kA", sang: "sA", long: "lO", blanc: "blA",
  franc: "fRA", banc: "bA", tabac: "taba", estomac: "Estoma", album: "albOm",
  boss: "bOs", bus: "bys", stress: "stREs", cash: "kaS", flash: "flaS", rap: "Rap",
  rappeur: "RapXR", clip: "klip", hip: "ip", hop: "op", drill: "dRil", trap: "tRap",
  game: "gEm", gang: "gAg", flow: "flo", show: "So", money: "mOnE", baby: "bEbi",
  aujourd: "oZuRd", "aujourd'hui": "oZuRdHi", jésus: "Zezy", fusil: "fyzi",
  outil: "uti", gentil: "ZAti", persil: "pERsi", sourcil: "suRsi",
  ennemi: "En@mi", ennemis: "En@mi", parfum: "paRfI", parfums: "paRfI",
};

const PRONOUNCED_S = new Set([
  "bis", "lys", "tennis", "atlas", "virus", "hélas", "as", "cactus", "bonus", "campus",
  "focus", "miss", "kiss", "ours", "mars", "jadis", "maïs", "vis", "oasis", "iris", "fils",
]);
const PRONOUNCED_T = new Set(["net", "brut", "but", "chut", "zut", "ouest", "sept", "huit", "foot", "shot", "out", "est"]);
const SILENT_P = new Set(["trop", "beaucoup", "loup", "coup", "drap", "sirop", "galop", "camp", "champ"]);

function isSilentEnt(word: string): boolean {
  if (!word.endsWith("ent") || word.length <= 4) return false;
  if (PRONOUNCED_ENT.has(word)) return false;
  if (word.endsWith("ment")) return VERBS_ENDING_IN_MENT.has(word);
  return true; // most other "-ent" words in lyrics are verbs ("ils parlent")
}

/**
 * Rewrites the end of a word into a canonical spelling where silent letters
 * are removed, so that the left-to-right pass only deals with pronounced
 * graphemes. Returns the canonical spelling.
 */
export function canonicalEnding(word: string): string {
  let w = word;
  if (w.length <= 1) return w;
  if (/[ae]mment$/.test(w)) return w.replace(/[ae]mment$/, "aman"); // évidemment
  if (w.endsWith("aient") || w.endsWith("ais") || w.endsWith("ait")) return w.replace(/(aient|ais|ait)$/, "è");
  if (/[vt]ient$/.test(w) && !PRONOUNCED_ENT.has(w)) return w.slice(0, -1); // vient, devient, tient
  if (isSilentEnt(w)) return w.slice(0, -3) + "e"; // parlent -> parle
  if (w.endsWith("ient") && w.length > 4) return w.slice(0, -4) + "ian"; // client, patient
  if (w.endsWith("ent")) return w.slice(0, -1); // moment -> momen (nasal e+n), argent
  if (/ieds?$/.test(w)) return w.replace(/ieds?$/, "ié"); // pied, assied
  if (/(ée|ées|és)$/.test(w)) return w.replace(/(ée|ées|és)$/, "é");
  if (w.endsWith("ez") && w.length > 2) return w.slice(0, -2) + "é";
  if (/ets?$/.test(w) && w.length > 2) return w.replace(/ets?$/, "è");
  if (w.endsWith("er") && w.length > 2 && !PRONOUNCED_ER.has(w)) return w.slice(0, -2) + "é";
  if (w.endsWith("ers") && w.length > 3 && !PRONOUNCED_ER.has(w) && !PRONOUNCED_ER.has(w.slice(0, -1)))
    return w.slice(0, -3) + "é";
  if (/aies?$/.test(w)) return w.replace(/aies?$/, "è");
  if (w.endsWith("ai") && w.length > 2) return w.slice(0, -2) + "é";

  // Final plural / silent consonants
  if (w.endsWith("es") && !ES_AS_E.has(w) && /[aeiouyéèêàâîôû]/.test(w.slice(0, -2))) {
    w = w.slice(0, -1); // belles -> belle (the e becomes a final schwa)
  } else if (/[sxz]$/.test(w) && !PRONOUNCED_S.has(w) && w.length > 2) {
    w = w.slice(0, -1);
    if (/[tdp]$/.test(w) && w.length > 2) w = w.slice(0, -1); // ts, ds -> silent
  }
  if (/[td]$/.test(w) && !PRONOUNCED_T.has(word) && w.length > 1 && isVowelLetter(w.at(-2)) ) {
    w = w.slice(0, -1);
  } else if (/[td]$/.test(w) && /[nrl]/.test(w.at(-2) ?? "") && !PRONOUNCED_T.has(word)) {
    w = w.slice(0, -1); // "grand", "fort", "regard"
  }
  if (w.endsWith("p") && (SILENT_P.has(word) || /[mr]p$/.test(w))) w = w.slice(0, -1);
  if (/gt$/.test(w)) w = w.slice(0, -2); // vingt, doigt
  if (/n[gc]$/.test(w)) w = w.slice(0, -1); // long, blanc
  return w;
}

function nasalFollows(w: string, i: number): boolean {
  // A vowel + n/m is nasal when followed by a consonant (not n/m) or the end.
  const next = w[i];
  if (next !== "n" && next !== "m") return false;
  const after = w[i + 1];
  if (after === undefined) return true;
  if (after === "n" || after === "m") return false;
  return !isVowelLetter(after) && after !== "h";
}

/** Converts one French word (lower-case, may contain apostrophes) to phonemes. */
export function frenchG2P(raw: string): string {
  const word = raw.toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüÿœæç']/g, "");
  if (!word) return "";
  if (word.includes("'")) {
    // "j'suis", "l'amour", "aujourd'hui" (override first)
    if (G2P_OVERRIDES[word]) return G2P_OVERRIDES[word];
    return word.split("'").map((p) => (p.length === 1 ? elidedConsonant(p) : frenchG2P(p))).join("");
  }
  if (G2P_OVERRIDES[word]) return G2P_OVERRIDES[word];
  const onset = (s: string) => (s === "c" ? "s" : frenchG2P(s));
  if (SCHWA_MONOSYLLABLES.has(word)) return onset(word.slice(0, -1)) + "@";
  if (ES_AS_E.has(word)) return word === "es" ? "E" : onset(word[0]) + "e";

  const w = canonicalEnding(word);
  let out = "";
  let i = 0;
  const at = (k: number) => w[k];
  const starts = (s: string, k = i) => w.startsWith(s, k);

  while (i < w.length) {
    const c = w[i];
    const n1 = at(i + 1);
    const prev = at(i - 1);

    // ---- endings in -ail / -eil / -euil / -ueil -----------------------------
    if (starts("ail") && i + 3 === w.length) { out += "aj"; i += 3; continue; }
    if (starts("eil") && i + 3 === w.length) { out += "Ej"; i += 3; continue; }
    if ((starts("euil") || starts("ueil")) && i + 4 === w.length) { out += "Xj"; i += 4; continue; }
    if (starts("um") && i + 2 === w.length && i > 0) { out += "Om"; i += 2; continue; }

    // ---- vowel groups --------------------------------------------------------
    if (starts("eau")) { out += "o"; i += 3; continue; }
    if (starts("oin") && nasalFollows(w, i + 2)) { out += "wI"; i += 3; continue; }
    if (starts("oy") && isVowelLetter(at(i + 2))) { out += "waj"; i += 2; continue; }
    if (starts("oi") || starts("oî")) { out += "wa"; i += 2; continue; }
    if (starts("ou") || starts("oû") || starts("où")) {
      const after = at(i + 2);
      const finalE = after === "e" && i + 3 === w.length;
      out += isVowelLetter(after) && !finalE ? "w" : "u";
      i += 2;
      continue;
    }
    if (starts("œu") || starts("eu")) {
      if (nasalFollows(w, i + 2) && starts("eun")) { out += "I"; i += 3; continue; } // à jeun
      out += "X"; i += 2; continue;
    }
    if (c === "œ") { out += "X"; i += 1; continue; }
    if (starts("aill") || starts("eill")) { out += c === "a" ? "aj" : "Ej"; i += 4; continue; }
    if (starts("ai") || starts("ei") || starts("aî") || starts("eî")) {
      if (nasalFollows(w, i + 2)) { out += "I"; i += 3; continue; }
      out += "E"; i += 2; continue;
    }
    if (starts("ay") && isVowelLetter(at(i + 2))) { out += "Ej"; i += 2; continue; }
    if (starts("ay")) { out += "E"; i += 2; continue; }
    if (starts("au")) { out += "o"; i += 2; continue; }
    if (starts("ien") && nasalFollows(w, i + 2)) {
      out += isConsonantLiquidCluster(w, i) ? "ijI" : "jI";
      i += 3;
      continue;
    }
    if (starts("ill")) {
      if (i === 0) { out += "il"; i += 3; continue; }
      if (isVowelLetter(prev)) { out += "j"; i += 3; continue; }
      out += "ij"; i += 3; continue;
    }
    if (starts("ui") && prev !== "q" && prev !== "g" && i > 0) { out += "Hi"; i += 2; continue; }

    if ("aàâä".includes(c)) {
      if (nasalFollows(w, i + 1)) { out += "A"; i += 2; continue; }
      out += "a"; i += 1; continue;
    }
    if (c === "é") { out += "e"; i += 1; continue; }
    if ("èêë".includes(c)) { out += "E"; i += 1; continue; }
    if ("iîïy".includes(c)) {
      if ((c === "i" || c === "y") && nasalFollows(w, i + 1)) { out += "I"; i += 2; continue; }
      const next = at(i + 1);
      if (c === "y" && (i === 0 || isVowelLetter(prev)) && isVowelLetter(next)) { out += "j"; i += 1; continue; }
      if ((c === "i" || c === "y") && isVowelLetter(next) && !(next === "e" && i + 2 === w.length) && i > 0) {
        // synérèse: "pied" -> pje, "lion" -> ljO ; diérèse after C+liquid: "crier"
        out += isConsonantLiquidCluster(w, i) ? "ij" : "j";
        i += 1;
        continue;
      }
      out += "i"; i += 1; continue;
    }
    if ("oôö".includes(c)) {
      if (nasalFollows(w, i + 1)) { out += "O"; i += 2; continue; }
      out += "o"; i += 1; continue;
    }
    if ("uûüù".includes(c)) {
      if (c === "u" && nasalFollows(w, i + 1)) { out += "I"; i += 2; continue; }
      out += "y"; i += 1; continue;
    }
    if (c === "e") {
      if (i === w.length - 1) { out += "@"; i += 1; continue; }
      if (nasalFollows(w, i + 1)) { out += "A"; i += 2; continue; }
      if ((n1 === "n" || n1 === "m") && at(i + 2) === n1 && i === 0) { out += "A"; i += 1; continue; } // ennui, emmener
      if (n1 === "x") { out += "E"; i += 1; continue; }
      if (isVowelLetter(n1)) { out += "E"; i += 1; continue; }
      const c1 = at(i + 1);
      const c2 = at(i + 2);
      if (c2 === undefined) { out += "E"; i += 1; continue; } // sec, chef, sel, fer
      if (!isVowelLetter(c2)) {
        // two consonants: schwa before a consonant+liquid cluster, open è otherwise
        const cluster = "lr".includes(c2) && "pbtdkgfvc".includes(c1) && c1 !== c2;
        const digraph = (c1 === "c" && c2 === "h") || (c1 === "p" && c2 === "h") || (c1 === "g" && c2 === "n") || (c1 === "q" && c2 === "u");
        out += cluster || digraph ? "@" : "E";
        i += 1;
        continue;
      }
      out += "@"; i += 1; continue; // single consonant + vowel: petit, devenir
    }

    // ---- consonants ----------------------------------------------------------
    if (c === "h") { i += 1; continue; }
    if (starts("ch")) { out += (at(i + 2) === "r" || at(i + 2) === "l") ? "k" : "S"; i += 2; continue; }
    if (starts("ph")) { out += "f"; i += 2; continue; }
    if (starts("th")) { out += "t"; i += 2; continue; }
    if (starts("gn")) { out += "G"; i += 2; continue; }
    if (starts("qu")) { out += "k"; i += 2; continue; }
    if (starts("gu") && FRONT.includes(at(i + 2) ?? "#")) { out += "g"; i += 2; continue; }
    if (starts("ge") && "aouâ".includes(at(i + 2) ?? "#")) { out += "Z"; i += 2; continue; }
    if (c === "g") {
      if (n1 === "g") { i += 1; continue; }
      out += FRONT.includes(n1 ?? "#") ? "Z" : "g"; i += 1; continue;
    }
    if (starts("cc") && FRONT.includes(at(i + 2) ?? "#")) { out += "ks"; i += 2; continue; }
    if (starts("ck")) { out += "k"; i += 2; continue; }
    if (c === "c") {
      if (n1 === "c") { i += 1; continue; }
      out += FRONT.includes(n1 ?? "#") ? "s" : "k"; i += 1; continue;
    }
    if (c === "ç") { out += "s"; i += 1; continue; }
    if (starts("tion") && i > 0) { out += prev === "s" || prev === "x" ? "tjO" : "sjO"; i += 4; continue; }
    if (starts("sc") && FRONT.includes(at(i + 2) ?? "#")) { out += "s"; i += 2; continue; }
    if (starts("sh")) { out += "S"; i += 2; continue; }
    if (c === "s") {
      if (n1 === "s") { out += "s"; i += 2; continue; }
      out += isVowelLetter(prev) && isVowelLetter(n1) ? "z" : "s"; i += 1; continue;
    }
    if (c === "x") {
      if (i === w.length - 1) { i += 1; continue; }
      out += i === 1 && w[0] === "e" && isVowelLetter(n1) ? "gz" : "ks"; i += 1; continue;
    }
    if (c === "j") { out += "Z"; i += 1; continue; }
    if (c === "r") { out += "R"; i += n1 === "r" ? 2 : 1; continue; }
    if (c === "w") { out += "w"; i += 1; continue; }
    if (c === "k" || c === "q") { out += "k"; i += 1; continue; }
    if ("bdfklmnptvz".includes(c)) {
      out += c;
      i += n1 === c ? 2 : 1; // doubled consonants
      continue;
    }
    i += 1; // unknown character
  }
  return out;
}

function isConsonantLiquidCluster(w: string, i: number): boolean {
  return "rl".includes(w[i - 1] ?? "#") && "pbtdkgfvc".includes(w[i - 2] ?? "#");
}

function elidedConsonant(letter: string): string {
  switch (letter) {
    case "j": return "Z";
    case "c": return "s";
    case "q": return "k";
    case "l": return "l";
    case "d": return "d";
    case "m": return "m";
    case "n": return "n";
    case "s": return "s";
    case "t": return "t";
    default: return "";
  }
}

/** Number of vowel phonemes, excluding a final silent schwa. */
export function countPhonemeSyllables(ph: string, keepFinalSchwa = false): number {
  let count = 0;
  for (const p of ph) if (VOWEL_PHONEMES.has(p)) count++;
  if (!keepFinalSchwa && count > 1 && /@[^aeEiouyX@AIO]*$/.test(ph)) count--;
  return count;
}

/** Number of internal schwas that a rapper may elide ("p'tit", "sam'di"). */
export function countElidableSchwas(ph: string): number {
  // a schwa between two consonants, not in final position
  const m = ph.slice(0, -1).match(/(?<=[^aeEiouyX@AIO])@(?=[^aeEiouyX@AIO])/g);
  return m ? m.length : 0;
}
