import { describe, expect, it } from "vitest";
import { enforceOriginality, REMOVED_LINE } from "@/lib/services/studio";
import { buildCatalogIndex, longestSharedRun, MAX_SHARED_WORDS } from "@/lib/text/recycling";
import { EMPTY_USAGE, type LLMProvider } from "@/lib/ai/types";
import type { ArtistContext } from "@/lib/ai/prompts/lyrics";
import type { LyricContent } from "@/lib/db/types";

const catalog = [
  { title: "Nuit blanche", lines: ["J'ai grandi dans le béton sans jamais baisser les yeux", "Les potes partent la vie c'est pas une fête"] },
  { title: "Bitume", lines: ["Mon cœur est froid comme le bitume en hiver", "On compte les billets dans la cage d'escalier"] },
];
const index = buildCatalogIndex(catalog);
const ctx = { stageName: "Nox", dnaVersion: 1, dna: {}, measures: { syllablesPerBar: 12, dominantPatterns: [], typicalStructure: [], signatureWords: [], adlibs: [] }, excerpts: [] } as unknown as ArtistContext;

function fakeLLM(lines: (n: number) => string[]): LLMProvider {
  return {
    name: "fake", model: "fake",
    async stream(req) {
      const n = Number(req.messages[0].content.match(/nombre="(\d+)"/)?.[1] ?? 1);
      const data = { safety: { status: "ok", reason: "" }, lines: lines(n), note: "" };
      return { data: data as never, rawText: "", stopReason: "end_turn", refusal: null, usage: EMPTY_USAGE, model: "fake", fallbackUsed: false };
    },
    submitBatch: async () => "", batchStatus: async () => "ended", batchResults: async () => new Map(),
  };
}

const content = (): LyricContent => ({
  sections: [{
    type: "couplet", label: "Couplet 1", bars: 4,
    lines: [
      "Toujours debout, j'ai grandi dans le béton sans faiblir", // 6 shared words
      "Une ligne parfaitement nouvelle sous la pluie fine",
      "Mon cœur est froid comme le bitume en hiver",              // copied
      "Encore une image inédite au bout du quai",
    ],
  }],
});

const assertOriginal = (c: LyricContent) => {
  for (const line of c.sections.flatMap((s) => s.lines)) {
    for (const src of catalog.flatMap((t) => t.lines)) {
      expect(longestSharedRun(line, src), `« ${line} » vs « ${src} »`).toBeLessThanOrEqual(MAX_SHARED_WORDS);
    }
  }
};

describe("critère d'acceptation : aucune version ne reprend plus de 4 mots consécutifs du catalogue", () => {
  it("réécrit automatiquement les lignes recyclées", async () => {
    const res = await enforceOriginality(content(), { ctx, index }, {
      explicit: false,
      llm: fakeLLM((n) => Array.from({ length: n }, (_, i) => `Nouvelle image originale numéro ${i + 1} sous les néons`)),
    });
    expect(res.report.fixed).toBe(2);
    expect(res.report.removed).toBe(0);
    assertOriginal(res.content);
  });

  it("retire la ligne si la réécriture recycle encore (garantie absolue)", async () => {
    const res = await enforceOriginality(content(), { ctx, index }, {
      explicit: false,
      llm: fakeLLM((n) => Array.from({ length: n }, () => "On compte les billets dans la cage d'escalier")),
    });
    expect(res.report.removed).toBe(2);
    expect(res.content.sections[0].lines.filter((l) => l === REMOVED_LINE)).toHaveLength(2);
    assertOriginal(res.content);
  });

  it("garde la garantie même si le fournisseur IA est en panne", async () => {
    const broken: LLMProvider = { ...fakeLLM(() => []), stream: async () => { throw new Error("down"); } };
    const res = await enforceOriginality(content(), { ctx, index }, { explicit: false, llm: broken });
    assertOriginal(res.content);
  });

  it("autorise le gimmick signature demandé explicitement", async () => {
    const c: LyricContent = { sections: [{ type: "refrain", label: "Refrain", bars: 1, lines: ["Les potes partent la vie c'est pas une fête"] }] };
    const res = await enforceOriginality(c, { ctx, index }, {
      explicit: false, allowed: ["Les potes partent, la vie c'est pas une fête"], llm: fakeLLM(() => ["x"]),
    });
    expect(res.content.sections[0].lines[0]).toBe("Les potes partent la vie c'est pas une fête");
  });
});
