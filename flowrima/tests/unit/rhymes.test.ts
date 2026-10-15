import { describe, expect, it } from "vitest";
import { analyzeRhymes, compareRimes, lineRime, tokenizeLine } from "@/lib/text/rhymes";

const rime = (l: string) => lineRime(tokenizeLine(l));

describe("rimes", () => {
  it("détecte une rime simple et une rime riche", () => {
    expect(compareRimes(rime("sous les néons de la ville"), rime("j'avance sur un fil"))).toBeGreaterThanOrEqual(2);
    expect(compareRimes(rime("les années"), rime("finir damné"))).toBe(3);
  });
  it("distingue assonance et absence de rime", () => {
    expect(compareRimes(rime("la tête"), rime("les années"))).toBe(1);
    expect(compareRimes(rime("la nuit"), rime("le bitume"))).toBe(0);
  });
  it("identifie le schéma AABB et les familles", () => {
    const a = analyzeRhymes([
      "J'rappe la nuit sous les néons de la ville",
      "Les yeux rougis, j'avance sur un fil",
      "Mon cœur est froid comme le bitume en hiver",
      "J'ai grandi vite, j'ai pas connu la lumière",
      "Dans le noir j'écris pour pas perdre la tête",
      "Les potes partent, la vie c'est pas une fête",
      "J'compte les billets, j'compte les années",
      "Tout c'que j'ai fait, c'est pour pas finir damné",
    ]);
    expect(a.scheme).toBe("AABBCCDD");
    expect(a.quatrains).toEqual({ AABB: 2 });
    expect(a.rhymedLineRate).toBe(1);
    expect(a.density).toBeGreaterThan(0.1);
  });
  it("identifie des rimes croisées ABAB", () => {
    const a = analyzeRhymes([
      "Je marche seul dans la ville",
      "Le ciel est lourd ce soir",
      "Mon pas reste tranquille",
      "Je garde encore l'espoir",
    ]);
    expect(a.quatrains).toEqual({ ABAB: 1 });
  });
  it("repère une rime multisyllabique", () => {
    const a = analyzeRhymes(["J'rêve de millions", "J'ai des visions"]);
    expect(a.lines[1].multi).toBeGreaterThanOrEqual(2);
  });
});

describe("internal rhymes ignore elided function words", () => {
  it("does not mark « J'ai » as an internal rhyme", () => {
    const res = analyzeRhymes(["J'ai grandi vite, j'ai pas connu la lumière", "Mon cœur est froid comme le bitume en hiver"]);
    const tokens = tokenizeLine("J'ai grandi vite, j'ai pas connu la lumière");
    const marked = res.lines[0].internal.map((k) => tokens[k]?.text.toLowerCase());
    expect(marked).not.toContain("j'ai");
  });
});
