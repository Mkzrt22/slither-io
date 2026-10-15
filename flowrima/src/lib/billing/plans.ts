import type { PlanId, PlanLimits } from "@/lib/db/types";

/**
 * Commercial catalogue (display + Stripe mapping). Quotas live in the
 * `plans` table (editable in the admin); these defaults mirror the seed
 * migration and are used when the database is not reachable (build time).
 */
export interface PlanCatalogEntry {
  id: PlanId;
  name: string;
  priceMonthlyCents: number;
  priceYearlyMonthlyCents?: number; // displayed monthly price when billed yearly
  availableNow: boolean;            // phase 1: free + artist
  highlight?: boolean;
  description: string;
  features: string[];
  limits: PlanLimits;
}

export const DEFAULT_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    tracks_max: 3, lyrics_generations: 3, retouches: 20, assists: 30, dna_analyses: 3, pdf_exports: 0,
    prod_credits_monthly: 0, prod_generations: 0, artist_profiles_max: 1, pdf_export: false, prod_ai: false,
    stems: false, history_days: 30, priority: false,
  },
  artist: {
    tracks_max: 30, lyrics_generations: 40, retouches: 300, assists: 400, dna_analyses: 10, pdf_exports: -1,
    prod_credits_monthly: 5, prod_generations: -1, artist_profiles_max: 1, pdf_export: true, prod_ai: true,
    stems: false, history_days: 365, priority: false,
  },
  pro: {
    tracks_max: -1, lyrics_generations: 150, retouches: 1000, assists: 1500, dna_analyses: 30, pdf_exports: -1,
    prod_credits_monthly: 25, prod_generations: -1, artist_profiles_max: 1, pdf_export: true, prod_ai: true,
    stems: true, history_days: -1, priority: true,
  },
  label: {
    tracks_max: -1, lyrics_generations: 400, retouches: 3000, assists: 4000, dna_analyses: 60, pdf_exports: -1,
    prod_credits_monthly: 80, prod_generations: -1, artist_profiles_max: 5, pdf_export: true, prod_ai: true,
    stems: true, history_days: -1, priority: true,
  },
};

const n = (x: number, unit: string) => (x === -1 ? `${unit} illimités` : `${x} ${unit}`);

export function planFeatures(id: PlanId, l: PlanLimits): string[] {
  switch (id) {
    case "free":
      return [
        `${l.tracks_max} titres analysés`,
        `${l.lyrics_generations} générations complètes / mois`,
        "ADN artistique visuel",
        "Éditeur : syllabes, rimes colorées",
        "Export TXT",
      ];
    case "artist":
      return [
        `${l.tracks_max} titres analysés`,
        `${l.lyrics_generations} générations complètes / mois`,
        "Retouches illimitées (usage raisonnable)",
        `${l.prod_credits_monthly} crédits prod IA / mois (phase 3)`,
        "Export PDF « fiche studio »",
        "Partage par lien privé",
      ];
    case "pro":
      return [
        n(l.tracks_max, "titres"),
        `${l.lyrics_generations} générations / mois`,
        `${l.prod_credits_monthly} crédits prod`,
        "Stems, historique complet",
        "File prioritaire",
      ];
    case "label":
      return [
        `${l.artist_profiles_max} profils artistes`,
        "Collaboration et rôles",
        `${l.prod_credits_monthly} crédits prod`,
        `${l.lyrics_generations} générations / mois`,
      ];
  }
}

export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    id: "free", name: "Découverte", priceMonthlyCents: 0, availableNow: true,
    description: "Pour tester avec tes premiers titres.", features: [], limits: DEFAULT_LIMITS.free,
  },
  {
    id: "artist", name: "Artiste", priceMonthlyCents: 1299, priceYearlyMonthlyCents: 999, availableNow: true, highlight: true,
    description: "Pour sortir plus souvent. Essai gratuit 7 jours.", features: [], limits: DEFAULT_LIMITS.artist,
  },
  {
    id: "pro", name: "Pro", priceMonthlyCents: 2999, availableNow: false,
    description: "Pour les artistes confirmés et toplineurs.", features: [], limits: DEFAULT_LIMITS.pro,
  },
  {
    id: "label", name: "Label / Studio", priceMonthlyCents: 9900, availableNow: false,
    description: "Pour gérer plusieurs artistes.", features: [], limits: DEFAULT_LIMITS.label,
  },
].map((p) => ({ ...p, features: planFeatures(p.id as PlanId, p.limits) })) as PlanCatalogEntry[];
