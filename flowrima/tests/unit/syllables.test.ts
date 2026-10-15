import { describe, expect, it } from "vitest";
import { countLineSyllables, countWordSyllables } from "@/lib/text/syllables";
import { numberToFrench, splitAdlibs, canonicalTokens } from "@/lib/text/normalize";

describe("comptage de syllabes (français parlé / rap)", () => {
  const cases: Array<[string, number]> = [
    ["parlent", 1], ["aiment", 1], ["vraiment", 2], ["jamais", 2], ["belles", 1], ["rue", 1],
    ["pied", 1], ["premier", 2], ["les", 1], ["ce", 1], ["j'suis", 1], ["l'amour", 2],
    ["nuit", 1], ["bien", 1], ["nation", 2], ["question", 2], ["reste", 1], ["petit", 2],
    ["maintenant", 3], ["toujours", 2], ["argent", 2], ["client", 2], ["moment", 2],
    ["hier", 1], ["cœur", 1], ["yeux", 1], ["voyage", 2], ["payer", 2], ["soleil", 2],
    ["famille", 2], ["guerre", 1], ["monde", 1], ["temps", 1], ["crier", 2], ["jouer", 1],
    ["idée", 2], ["homme", 1], ["quartier", 2], ["encore", 2], ["besoin", 2], ["devient", 2],
    ["parlaient", 2], ["évidemment", 4], ["galère", 2], ["galères", 2], ["yeah", 1], ["money", 2],
  ];
  it.each(cases)("%s = %i", (word, expected) => {
    expect(countWordSyllables(word).count).toBe(expected);
  });

  it("compte une ligne avec élisions, nombres et ad-libs", () => {
    expect(countLineSyllables("J'rappe la nuit sous les néons de la ville").count).toBe(10);
    // 93 = quatre-vingt-treize = 3 ; l'ad-lib "(yeah)" n'est pas comptée
    expect(countLineSyllables("Le 93 en bas du bloc (yeah)").count).toBe(8);
  });

  it("fournit une fourchette d'élision (p'tit, sam'di)", () => {
    const r = countLineSyllables("Le petit samedi");
    expect(r.min).toBeLessThan(r.count);
    expect(r.max).toBeGreaterThanOrEqual(r.count);
  });
});

describe("normalisation", () => {
  it("écrit les nombres en toutes lettres", () => {
    expect(numberToFrench(93)).toBe("quatre-vingt-treize");
    expect(numberToFrench(71)).toBe("soixante-et-onze");
    expect(numberToFrench(2010)).toBe("deux-mille-dix");
    expect(numberToFrench(100)).toBe("cent");
  });
  it("sépare les ad-libs entre parenthèses", () => {
    expect(splitAdlibs("J'avance (skrrt) sans freiner (yeah)")).toEqual({
      main: "J'avance sans freiner",
      adlibs: ["skrrt", "yeah"],
    });
  });
  it("produit des jetons canoniques insensibles aux accents et apostrophes", () => {
    expect(canonicalTokens("J'ai été là-bas (ouais)")).toEqual(["jai", "ete", "la", "bas"]);
  });
});
