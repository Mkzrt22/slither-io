/**
 * Syllable counting for lyric lines (French first, English and mixed lines
 * supported). The "spoken" count is what a rapper would say: final e muet
 * dropped, synérèse ("lion" = 1). min/max give the elision range.
 */
import { EN_WORDS, SYLLABLE_OVERRIDES } from "./lexicon";
import { countElidableSchwas, countPhonemeSyllables, frenchG2P } from "./french-g2p";
import { englishSyllables } from "./english";
import { splitAdlibs, tokenizeWords } from "./normalize";

export type Lang = "fr" | "en";

export interface WordSyllables {
  word: string;
  count: number;
  /** Internal schwas that can be elided ("p'tit"). */
  elidable: number;
  lang: Lang;
  phonemes: string;
}

export interface LineSyllables {
  count: number;
  min: number;
  max: number;
  words: WordSyllables[];
}

export function isEnglishWord(word: string, lineLang: Lang = "fr"): boolean {
  const w = word.replace(/'/g, "");
  if (lineLang === "en") return true;
  return EN_WORDS.has(w);
}

export function countWordSyllables(word: string, lineLang: Lang = "fr"): WordSyllables {
  const clean = word.toLowerCase();
  const override = SYLLABLE_OVERRIDES[clean] ?? SYLLABLE_OVERRIDES[clean.replace(/'/g, "")];
  if (isEnglishWord(clean, lineLang)) {
    return {
      word: clean,
      count: override ?? englishSyllables(clean),
      elidable: 0,
      lang: "en",
      phonemes: "",
    };
  }
  const phonemes = frenchG2P(clean);
  const count = override ?? Math.max(countPhonemeSyllables(phonemes), clean.length > 0 ? 1 : 0);
  return { word: clean, count, elidable: override ? 0 : countElidableSchwas(phonemes), lang: "fr", phonemes };
}

/**
 * Detects whether a line is mostly English (used for EN catalogues and for
 * the language-mix statistic of the DNA).
 */
export function detectLineLang(text: string): Lang {
  const words = tokenizeWords(text);
  if (words.length === 0) return "fr";
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  return en / words.length >= 0.5 ? "en" : "fr";
}

/** Counts the syllables of the sung part of a line (ad-libs excluded). */
export function countLineSyllables(line: string, lang?: Lang): LineSyllables {
  const { main } = splitAdlibs(line);
  const lineLang = lang ?? detectLineLang(main);
  const words = tokenizeWords(main).map((w) => countWordSyllables(w, lineLang));
  const count = words.reduce((s, w) => s + w.count, 0);
  const elidable = words.reduce((s, w) => s + w.elidable, 0);
  // A final e muet can be sung before a consonant in "chanté" styles: +1 per such word, capped.
  const singable = words.filter((w, i) => i < words.length - 1 && /@[^aeEiouyX@AIO]*$/.test(w.phonemes) && w.count >= 1).length;
  return { count, min: Math.max(0, count - elidable), max: count + Math.min(singable, 3), words };
}
