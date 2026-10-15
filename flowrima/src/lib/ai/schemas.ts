/**
 * JSON schemas (zod) for every structured output. They are sent to the API
 * through `output_config.format` and validated again on our side.
 * Numeric ranges and array sizes are not enforced by the API (unsupported in
 * structured outputs): they are described in the schema and clamped in code.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// ADN artistique (prompt 7.1)
// -----------------------------------------------------------------------------
export const DnaSchema = z.object({
  summary: z.string().describe("Portrait de l'artiste en 3-4 phrases, langage simple"),
  signature_points: z
    .array(z.string())
    .describe("Exactement 5 points « Ta signature en 5 points », phrases courtes adressées à l'artiste (tu)"),
  themes: z
    .array(
      z.object({
        name: z.string(),
        weight: z.number().describe("Importance entre 0 et 1"),
        evidence: z.array(z.string()).describe("1 à 3 titres ou citations très courtes (≤ 8 mots) du corpus"),
      }),
    )
    .describe("4 à 8 thèmes récurrents, du plus au moins présent"),
  lexical_fields: z.array(z.object({ name: z.string(), words: z.array(z.string()) })),
  signature_words: z.array(z.object({ word: z.string(), why: z.string() })),
  emotions: z.array(z.object({ name: z.string(), weight: z.number().describe("0 à 1") })),
  register: z.object({
    level: z.enum(["soutenu", "courant", "familier", "argotique", "mixte"]),
    description: z.string(),
  }),
  languages: z.array(
    z.object({ code: z.string().describe("fr, en, ar, créole…"), share: z.number().describe("0 à 1"), notes: z.string() }),
  ),
  slang: z.object({
    argot: z.array(z.string()),
    verlan: z.array(z.string()),
    foreign_words: z.array(z.string()),
  }),
  point_of_view: z.object({
    dominant: z.enum(["je", "tu", "nous", "il_elle", "mixte"]),
    description: z.string(),
  }),
  devices: z.array(
    z.object({
      name: z.string().describe("punchline, métaphore, double sens, egotrip, storytelling, comparaison, anaphore…"),
      frequency: z.enum(["rare", "régulier", "signature"]),
      examples: z.array(z.string()).describe("citations très courtes (≤ 8 mots)"),
    }),
  ),
  rhyme_style: z.object({
    dominant_schemes: z.array(z.string()),
    multisyllabic: z.enum(["rare", "régulier", "signature"]),
    internal_rhymes: z.enum(["rare", "régulier", "signature"]),
    notes: z.string(),
  }),
  flow: z.object({
    syllables_per_bar: z.number(),
    description: z.string().describe("débit, respirations, placements, variations"),
  }),
  typical_structure: z.object({
    sections: z.array(z.object({ type: z.string(), bars: z.number() })),
    notes: z.string(),
  }),
  gimmicks: z.array(z.string()),
  adlibs: z.array(z.string()),
  evolution: z.object({
    summary: z.string(),
    early_traits: z.array(z.string()),
    recent_traits: z.array(z.string()),
  }),
  unexplored_themes: z
    .array(z.string())
    .describe("5 à 8 sujets cohérents avec l'univers de l'artiste mais jamais abordés (pour « Inspire-moi »)"),
});
export type DnaOutput = z.infer<typeof DnaSchema>;

/** Light per-track analysis used by the Batch API path for large catalogues. */
export const TrackDnaSchema = z.object({
  themes: z.array(z.object({ name: z.string(), weight: z.number() })),
  emotions: z.array(z.string()),
  devices: z.array(z.string()),
  point_of_view: z.string(),
  register: z.string(),
  notable_lines: z.array(z.string()).describe("2 à 3 lignes les plus représentatives"),
  summary: z.string(),
});
export type TrackDnaOutput = z.infer<typeof TrackDnaSchema>;

// -----------------------------------------------------------------------------
// Génération de paroles (prompt 7.2)
// -----------------------------------------------------------------------------
export const SECTION_TYPES = ["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"] as const;

export const SectionSchema = z.object({
  type: z.enum(SECTION_TYPES),
  label: z.string().describe("ex. « Couplet 1 », « Refrain »"),
  bars: z.number().describe("nombre de mesures = nombre de lignes"),
  flow: z.object({
    pace: z.enum(["lent", "moyen", "rapide", "variable"]),
    notes: z.string().describe("placement sur la grille, respirations, changements de flow (1 phrase)"),
  }),
  lines: z
    .array(z.string())
    .describe("une ligne = une mesure ; ad-libs entre parenthèses ; « / » marque une respiration"),
});
export type GeneratedSection = z.infer<typeof SectionSchema>;

export const ProposalSchema = z.object({
  variant: z.enum(["A", "B", "C"]),
  angle: z.string().describe("l'angle choisi en une phrase"),
  title: z.string(),
  sections: z.array(SectionSchema),
  why_it_sounds_like_you: z.array(z.string()).describe("2 à 3 lignes : ce qui reprend l'ADN"),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const LyricsOutputSchema = z.object({
  safety: z.object({
    status: z.enum(["ok", "declined"]),
    reason: z.string().describe("vide si ok ; sinon explication courte et neutre pour l'artiste"),
  }),
  proposals: z.array(ProposalSchema).describe("exactement 3 propositions : A, B puis C"),
});
export type LyricsOutput = z.infer<typeof LyricsOutputSchema>;

// -----------------------------------------------------------------------------
// Retouches (ligne, partie, refrain) et adaptation au BPM
// -----------------------------------------------------------------------------
export const RetouchOutputSchema = z.object({
  safety: z.object({ status: z.enum(["ok", "declined"]), reason: z.string() }),
  lines: z.array(z.string()).describe("les nouvelles lignes, autant que demandé"),
  note: z.string().describe("ce qui a changé, une phrase"),
});
export type RetouchOutput = z.infer<typeof RetouchOutputSchema>;

// -----------------------------------------------------------------------------
// Assistant d'écriture : rimes et synonymes contextuels
// -----------------------------------------------------------------------------
export const AssistOutputSchema = z.object({
  rhymes: z.array(
    z.object({
      word: z.string(),
      kind: z.enum(["riche", "suffisante", "assonance", "multisyllabique"]),
      fits_style: z.boolean().describe("colle au vocabulaire de l'artiste"),
    }),
  ),
  synonyms: z.array(z.string()),
  line_ideas: z.array(z.string()).describe("2 à 3 idées de fin de ligne qui riment, inédites"),
});
export type AssistOutput = z.infer<typeof AssistOutputSchema>;
