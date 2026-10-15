import "server-only";
import type { z } from "zod";
import { findRhymes } from "@/lib/text/rhyme-dictionary";
import { unescapeData } from "./sanitize";
import type {
  AssistOutput, DnaOutput, LyricsOutput, Proposal, RetouchOutput, TrackDnaOutput,
} from "./schemas";
import {
  EMPTY_USAGE,
  type BatchItem,
  type BatchStatus,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from "./types";

/**
 * Deterministic offline provider. Used when no ANTHROPIC_API_KEY is set
 * (local development, previews, end-to-end tests). Outputs follow the real
 * schemas and are built from the request so that the whole pipeline (quotas,
 * anti-recycling, editor, exports) can be exercised for free.
 */

const between = (text: string, tagName: string) =>
  unescapeData(text.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`))?.[1]?.trim() ?? "");

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const FAMILIES = [
  ["nuit", "bruit", "fuit", "minuit", "ennui", "conduit"],
  ["béton", "horizon", "raison", "frisson", "saison", "néons"],
  ["mémoire", "histoire", "victoire", "trottoir", "espoir", "miroir"],
  ["tempête", "conquête", "défaite", "planète", "silhouette", "quête"],
  ["lumière", "poussière", "prière", "colère", "frontière", "hier"],
  ["destin", "chemin", "demain", "festin", "matin", "requin"],
];
const OPENINGS = [
  "J'avance seul", "Dans la ville", "Les yeux ouverts", "Sans faire de bruit", "Toujours debout",
  "Le cœur en feu", "Loin des regards", "Sous la pluie fine", "Au bout du quai", "Entre deux mondes",
  "Les poches vides", "La tête haute", "Au fond du bloc", "Plus vite encore",
];
const MIDDLES = [
  "je cherche encore", "j'écris pour", "on court après", "je garde en moi", "le temps efface",
  "je laisse filer", "je trace vers", "on rêve de", "j'ai vu passer", "je danse avec",
];

function mockLines(seed: string, count: number, familyOffset: number): string[] {
  const h = hash(seed);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const fam = FAMILIES[(familyOffset + Math.floor(i / 2)) % FAMILIES.length];
    const end = fam[(h + i) % fam.length];
    const open = OPENINGS[(h + i * 7) % OPENINGS.length];
    const mid = MIDDLES[(h + i * 3) % MIDDLES.length];
    const adlib = i % 4 === 3 ? " (yeah)" : "";
    lines.push(`${open}, ${mid} / ${["la", "le", "ce", "mon"][i % 4]} ${end}${adlib}`);
  }
  return lines;
}

function mockDna(user: string): DnaOutput {
  let signature: string[] = [];
  try {
    const m = JSON.parse(between(user, "mesures_catalogue") || "{}");
    signature = (m.mots_signatures_calcules ?? []).slice(0, 8);
  } catch {
    /* keep defaults */
  }
  const titles = [...user.matchAll(/<titre nom="([^"]*)"/g)].map((m) => m[1]);
  const words = signature.length ? signature : ["nuit", "ville", "rêve", "argent"];
  return {
    summary: `Mode démo (sans clé API) : un style introspectif et urbain, des images de ${words.slice(0, 3).join(", ")} et un flow régulier.`,
    signature_points: [
      `Tu reviens souvent à « ${words[0]} » : c'est ton image fétiche.`,
      "Tu écris à la première personne, comme un journal intime.",
      "Tes refrains sont courts et répétitifs, faciles à retenir.",
      "Tu alternes rimes plates et rimes suivies sur 4 mesures.",
      "Tu mélanges un français courant avec un peu d'argot.",
    ],
    themes: [
      { name: "La ville la nuit", weight: 0.8, evidence: titles.slice(0, 2) },
      { name: "L'ambition", weight: 0.6, evidence: titles.slice(1, 3) },
      { name: "La famille", weight: 0.4, evidence: titles.slice(0, 1) },
      { name: "La solitude", weight: 0.35, evidence: titles.slice(2, 3) },
    ],
    lexical_fields: [
      { name: "Urbain", words: ["bloc", "béton", "rue", "quartier"] },
      { name: "Intérieur", words: ["cœur", "doute", "rêve", "mémoire"] },
    ],
    signature_words: words.map((w) => ({ word: w, why: "très fréquent dans tes titres" })),
    emotions: [
      { name: "mélancolie", weight: 0.6 },
      { name: "détermination", weight: 0.7 },
    ],
    register: { level: "familier", description: "Français courant, quelques mots d'argot." },
    languages: [{ code: "fr", share: 0.92, notes: "quelques mots d'anglais en ad-libs" }],
    slang: { argot: ["thune", "gova"], verlan: ["vénère"], foreign_words: ["yeah"] },
    point_of_view: { dominant: "je", description: "Récit à la première personne." },
    devices: [
      { name: "punchline", frequency: "régulier", examples: ["la tête haute"] },
      { name: "métaphore", frequency: "signature", examples: ["le cœur en béton"] },
    ],
    rhyme_style: {
      dominant_schemes: ["AABB", "AAAA"],
      multisyllabic: "régulier",
      internal_rhymes: "rare",
      notes: "Rimes surtout en fin de mesure.",
    },
    flow: { syllables_per_bar: 12, description: "Débit moyen, respirations en milieu de mesure." },
    typical_structure: {
      sections: [
        { type: "couplet", bars: 16 },
        { type: "refrain", bars: 8 },
        { type: "couplet", bars: 16 },
        { type: "refrain", bars: 8 },
      ],
      notes: "Structure classique couplet / refrain.",
    },
    gimmicks: ["toujours debout"],
    adlibs: ["yeah", "eh"],
    evolution: {
      summary: "Les titres récents sont plus mélodiques.",
      early_traits: ["flow plus rapide"],
      recent_traits: ["refrains chantés"],
    },
    unexplored_themes: ["Une lettre à ton toi de 12 ans", "Une nuit de tournée", "L'amour à distance", "Le premier studio", "Ton quartier dans 20 ans"],
  };
}

function mockLyrics(user: string): LyricsOutput {
  let structure: Array<{ partie: string; type: string; mesures: number }> = [];
  try {
    structure = JSON.parse(between(user, "structure") || "[]");
  } catch {
    structure = [];
  }
  if (!structure.length) structure = [{ partie: "Couplet 1", type: "couplet", mesures: 8 }, { partie: "Refrain", type: "refrain", mesures: 4 }];
  const subject = between(user, "sujet") || "la nuit";
  const keyPhrase = between(user, "phrase_cle");
  const variants: Array<["A" | "B" | "C", string]> = [
    ["A", "Fidèle : ton récit à la première personne, images urbaines"],
    ["B", "Évolution : plus mélodique, refrain chanté"],
    ["C", "Audace : point de vue inversé, structure de rimes croisées"],
  ];
  const proposals: Proposal[] = variants.map(([variant, angle], vi) => ({
    variant,
    angle,
    title: `${subject.slice(0, 30)} (${variant})`,
    sections: structure.map((s, si) => {
      const lines = mockLines(`${variant}-${si}-${subject}`, Math.max(1, Math.min(32, s.mesures)), vi * 2 + si);
      if (keyPhrase && si === 0) lines[0] = keyPhrase;
      return {
        type: (["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"].includes(s.type) ? s.type : "couplet") as Proposal["sections"][number]["type"],
        label: s.partie,
        bars: s.mesures,
        flow: { pace: (["moyen", "rapide", "lent"] as const)[vi], notes: "Placement sur le temps, respiration au milieu de la mesure." },
        lines,
      };
    }),
    why_it_sounds_like_you: [
      "Première personne et images de la ville, comme dans tes titres.",
      "Rimes plates en fin de mesure, ton schéma dominant.",
    ],
  }));
  return { safety: { status: "ok", reason: "" }, proposals };
}

function mockRetouch(user: string): RetouchOutput {
  const n = Number(user.match(/<lignes_a_retoucher nombre="(\d+)"/)?.[1] ?? 1);
  const action = between(user, "action");
  return {
    safety: { status: "ok", reason: "" },
    lines: mockLines(`${action}-${user.length}`, n, user.length % FAMILIES.length),
    note: "Mode démo : lignes réécrites sans IA.",
  };
}

function mockAssist(user: string): AssistOutput {
  const word = between(user, "mot") || "nuit";
  const rhymes = findRhymes(word, [], 12);
  return {
    rhymes: rhymes.map((r) => ({
      word: r.word,
      kind: r.multi >= 2 ? "multisyllabique" : r.level === 3 ? "riche" : r.level === 2 ? "suffisante" : "assonance",
      fits_style: r.fromArtist,
    })),
    synonyms: [],
    line_ideas: rhymes.slice(0, 2).map((r) => `… et j'garde en tête ${r.word}`),
  };
}

function mockTrackDna(): TrackDnaOutput {
  return {
    themes: [{ name: "La ville", weight: 0.7 }],
    emotions: ["mélancolie"],
    devices: ["métaphore"],
    point_of_view: "je",
    register: "familier",
    notable_lines: [],
    summary: "Mode démo.",
  };
}

function build(task: LLMRequest<unknown>["task"], user: string): unknown {
  switch (task) {
    case "dna": return mockDna(user);
    case "dna_track": return mockTrackDna();
    case "lyrics": return mockLyrics(user);
    case "retouch": return mockRetouch(user);
    case "assist": return mockAssist(user);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-claude";
  private batches = new Map<string, BatchItem<unknown>[]>();

  constructor(private readonly delayMs = Number(process.env.MOCK_LLM_DELAY_MS ?? 15)) {}

  async stream<T>(req: LLMRequest<T>, onText?: (delta: string) => void): Promise<LLMResult<T>> {
    const user = req.messages.map((m) => m.content).join("\n");
    const text = JSON.stringify(build(req.task, user));
    if (onText) {
      for (let i = 0; i < text.length; i += 48) {
        if (req.signal?.aborted) break;
        onText(text.slice(i, i + 48));
        if (this.delayMs) await sleep(this.delayMs);
      }
    }
    const parsed = req.schema.safeParse(JSON.parse(text));
    const inputTokens = Math.ceil((req.system.map((s) => s.text).join("").length + user.length) / 4);
    return {
      data: parsed.success ? parsed.data : null,
      rawText: text,
      stopReason: "end_turn",
      refusal: null,
      usage: { ...EMPTY_USAGE, inputTokens, outputTokens: Math.ceil(text.length / 4) },
      model: this.model,
      fallbackUsed: false,
      error: parsed.success ? undefined : parsed.error.message,
    };
  }

  async submitBatch<T>(items: BatchItem<T>[]): Promise<string> {
    const id = `mockbatch_${hash(items.map((i) => i.customId).join())}`;
    this.batches.set(id, items as BatchItem<unknown>[]);
    return id;
  }

  async batchStatus(): Promise<BatchStatus> {
    return "ended";
  }

  async batchResults<T>(batchId: string, schema: z.ZodType<T>): Promise<Map<string, LLMResult<T>>> {
    const out = new Map<string, LLMResult<T>>();
    for (const it of this.batches.get(batchId) ?? []) {
      const r = await this.stream({ ...it.request, schema } as LLMRequest<T>);
      out.set(it.customId, r);
    }
    return out;
  }
}
