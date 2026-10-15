import { z } from "zod";

/** Request bodies of the studio API (shared by routes and client). */
export const StructureItem = z.object({
  type: z.enum(["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"]),
  label: z.string().trim().min(1).max(40),
  bars: z.number().int().min(1).max(32),
});

export const GenerateBody = z.object({
  projectId: z.string().uuid(),
  params: z.object({
    subject: z.string().trim().max(600).optional(),
    workingTitle: z.string().trim().max(120).optional(),
    mood: z.string().trim().max(60).optional(),
    keyPhrase: z.string().trim().max(200).optional(),
    inspireMe: z.boolean().default(false),
    fidelity: z.number().min(0).max(100).default(70),
    structure: z.array(StructureItem).min(1).max(12),
    bpm: z.number().min(40).max(250).nullable().optional(),
    musicalKey: z.string().trim().max(12).nullable().optional(),
    languages: z.array(z.string().max(10)).min(1).max(5).default(["fr"]),
    explicit: z.boolean().default(false),
    allowedGimmick: z.string().trim().max(120).nullable().optional(),
    styleReference: z.string().trim().max(200).nullable().optional(),
  }).refine((p) => p.inspireMe || (p.subject && p.subject.length >= 3), {
    message: "Indique un sujet ou choisis « Inspire-moi ».",
  }),
});
export type GenerateBodyT = z.infer<typeof GenerateBody>;

export const RETOUCH_ACTION_IDS = [
  "regenerate", "punchier", "darker", "richer_rhymes", "simpler", "double_meaning", "fit_bpm",
] as const;

export const RetouchBody = z.object({
  projectId: z.string().uuid(),
  action: z.enum(RETOUCH_ACTION_IDS),
  song: z.array(
    z.object({
      type: z.enum(["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"]),
      label: z.string().max(40),
      bars: z.number().int().min(0).max(64),
      lines: z.array(z.string().max(300)).max(64),
    }),
  ).min(1).max(20),
  sectionIndex: z.number().int().min(0),
  lineIndexes: z.array(z.number().int().min(0)).min(1).max(32),
  keepRhyme: z.string().max(40).nullable().optional(),
  bpm: z.number().min(40).max(250).nullable().optional(),
  explicit: z.boolean().default(false),
});
export type RetouchBodyT = z.infer<typeof RetouchBody>;
