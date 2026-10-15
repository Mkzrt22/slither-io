import type { GenerateBodyT } from "@/lib/studio-schemas";
import { SECTION_LABELS, type SectionType } from "@/lib/text/parse";

/** Shared (server + client) helpers for the song structure editor. */
type StructureItem = GenerateBodyT["params"]["structure"][number];

export interface StudioDefaults {
  genre: string;
  languages: string[];
  explicit: boolean;
  artistSyllables: number | null;
  structure: StructureItem[];
  inspirations: string[];
  gimmicks: string[];
}

const TYPES: Array<StructureItem["type"]> = ["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"];
export const DEFAULT_BARS: Record<StructureItem["type"], number> = { intro: 4, couplet: 16, pre_refrain: 4, refrain: 8, pont: 8, outro: 4 };

/** Labels "Couplet 1", "Couplet 2"… recomputed from types. */
export function relabel(items: Array<Omit<StructureItem, "label"> & { label?: string }>): StructureItem[] {
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  items.forEach((i) => (totals[i.type] = (totals[i.type] ?? 0) + 1));
  return items.map((i) => {
    counts[i.type] = (counts[i.type] ?? 0) + 1;
    const base = SECTION_LABELS[i.type as SectionType];
    return { ...i, label: i.type === "couplet" || totals[i.type] > 1 && i.type !== "refrain" ? `${base} ${counts[i.type]}` : base };
  });
}

export function defaultStructure(sequence: string[] | undefined, coupletBars = 16, refrainBars = 8): StructureItem[] {
  const seq = (sequence?.length ? sequence : ["couplet", "refrain", "couplet", "refrain"]).filter((t): t is StructureItem["type"] =>
    TYPES.includes(t as StructureItem["type"]),
  );
  return relabel(
    seq.slice(0, 8).map((type) => ({
      type,
      bars: type === "couplet" ? Math.min(32, Math.max(4, coupletBars)) : type === "refrain" ? Math.min(16, Math.max(2, refrainBars)) : DEFAULT_BARS[type],
    })),
  );
}

