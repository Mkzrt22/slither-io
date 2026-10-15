import { describe, expect, it } from "vitest";
import { buildCatalogIndex, checkRecycling, longestSharedRun, MAX_SHARED_WORDS } from "@/lib/text/recycling";

const catalog = [
  { title: "Nuit blanche", lines: ["J'ai grandi dans le béton sans jamais baisser les yeux", "Les potes partent, la vie c'est pas une fête"] },
  { title: "Bitume", lines: ["Mon cœur est froid comme le bitume en hiver"] },
];
const index = buildCatalogIndex(catalog);

describe("anti-recyclage", () => {
  it("bloque une suite de plus de 4 mots identiques", () => {
    const v = checkRecycling(["Toujours debout, j'ai grandi dans le béton sans faiblir"], index);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("ngram");
    expect(v[0].source.trackTitle).toBe("Nuit blanche");
  });
  it("autorise jusqu'à 4 mots identiques", () => {
    const line = "Ce soir j'ai grandi dans le noir";
    expect(longestSharedRun(line, catalog[0].lines[0])).toBeLessThanOrEqual(MAX_SHARED_WORDS);
    expect(checkRecycling([line], index).filter((x) => x.type === "ngram")).toHaveLength(0);
  });
  it("ignore la casse, les accents et la ponctuation", () => {
    const v = checkRecycling(["MON COEUR est froid, comme le bitume !"], index);
    expect(v.some((x) => x.type === "ngram")).toBe(true);
  });
  it("autorise un gimmick signature demandé explicitement", () => {
    const v = checkRecycling(["Les potes partent la vie c'est pas une fête"], index, {
      allowed: ["Les potes partent, la vie c'est pas une fête"],
    });
    expect(v.filter((x) => x.type === "ngram")).toHaveLength(0);
  });
  it("signale une quasi-copie", () => {
    const v = checkRecycling(["Mon cœur est glacé comme le bitume en hiver"], index);
    expect(v.length).toBeGreaterThan(0);
  });
});
