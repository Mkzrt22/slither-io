/**
 * English heuristics (syllables + orthographic rime) for English lyrics and
 * for English words mixed into French lines.
 */

export function englishSyllables(raw: string): number {
  let w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // silent endings
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, (m) => (m === "ed" ? "d" : m.slice(0, -1)));
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  let count = groups ? groups.length : 1;
  // consonant + "le" at the end is a syllable ("little", "bottle")
  if (/[^aeiouy]le$/.test(raw.toLowerCase())) count++;
  // "-ia", "-io" usually split ("via", "radio")
  if (/[^aeiou](ia|io)/.test(w)) count++;
  return Math.max(1, count);
}

/** Orthographic rime: from the last vowel group to the end, silent e removed. */
export function englishRime(raw: string): string {
  const w = raw.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "");
  const m = w.match(/[aeiouy]+[^aeiouy]*$/);
  let r = m ? m[0] : w;
  r = r
    .replace(/igh/g, "i")
    .replace(/ee|ea/g, "i")
    .replace(/oo/g, "u")
    .replace(/ow$/g, "o")
    .replace(/y$/g, "i");
  return r;
}
