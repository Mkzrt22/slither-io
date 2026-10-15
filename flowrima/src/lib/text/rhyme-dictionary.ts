/**
 * Offline rhyme dictionary: instant and free (no AI call). Candidates come from
 * the artist's own vocabulary first, then a common rap vocabulary.
 */
import { frenchG2P } from "./french-g2p";
import { compareRimes, multisyllabicLength, rimeOfPhonemes } from "./rhymes";
import { RHYME_VOCAB } from "./vocabulary";
import { stripAccents } from "./normalize";

export interface RhymeSuggestion {
  word: string;
  level: 1 | 2 | 3; // assonance, rime, rime riche
  multi: number;    // matching vowels from the end
  fromArtist: boolean;
}

export function findRhymes(word: string, artistVocabulary: string[] = [], limit = 30): RhymeSuggestion[] {
  const target = rimeOfPhonemes(frenchG2P(word.toLowerCase()));
  if (!target) return [];
  const seen = new Set<string>([stripAccents(word.toLowerCase())]);
  const out: RhymeSuggestion[] = [];
  const consider = (w: string, fromArtist: boolean) => {
    const key = stripAccents(w.toLowerCase());
    if (seen.has(key) || w.length < 2) return;
    seen.add(key);
    const r = rimeOfPhonemes(frenchG2P(w));
    const level = compareRimes(target, r);
    if (level < 1) return;
    out.push({ word: w, level: level as 1 | 2 | 3, multi: multisyllabicLength(target, r), fromArtist });
  };
  artistVocabulary.forEach((w) => consider(w, true));
  RHYME_VOCAB.forEach((w) => consider(w, false));
  return out
    .sort(
      (a, b) =>
        b.level - a.level ||
        b.multi - a.multi ||
        Number(b.fromArtist) - Number(a.fromArtist) ||
        a.word.localeCompare(b.word, "fr"),
    )
    .slice(0, limit);
}
