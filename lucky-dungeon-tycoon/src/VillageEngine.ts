/**
 * VillageEngine.ts — Village & Building progression (Lucky Dungeon Tycoon).
 *
 * The core idle loop: each village holds six upgradeable buildings that
 * generate passive gold. Raising buildings advances a progress bar; once the
 * required total of building levels is reached, the player unlocks the next
 * village, which grants a permanent global production multiplier and a new
 * theme. Buildings and gold are *not* reset on advancing — villages are pure
 * forward progression (only Ascension does a hard reset).
 *
 * Stateless and pure; depends only on the domain types.
 */

import { BUILDING_TYPES, BuildingType, UserProfile } from './types.js';

export interface BuildingConfig {
  name: string;
  icon: string;
  /** Cost to build the first level. */
  baseCost: number;
  /** Geometric cost growth per level already owned. */
  costGrowth: number;
  /** Gold/second produced per level (before global multipliers). */
  baseProd: number;
}

export const BUILDING_CONFIGS: Readonly<Record<BuildingType, BuildingConfig>> =
  Object.freeze({
    mine:       { name: 'Mine d’or',  icon: '⛏️', baseCost: 30,      costGrowth: 1.18, baseProd: 1 },
    farm:       { name: 'Ferme',      icon: '🌾', baseCost: 130,     costGrowth: 1.19, baseProd: 4 },
    sawmill:    { name: 'Scierie',    icon: '🪵', baseCost: 700,     costGrowth: 1.20, baseProd: 16 },
    market:     { name: 'Marché',     icon: '🏪', baseCost: 3_500,   costGrowth: 1.21, baseProd: 60 },
    blacksmith: { name: 'Forge',      icon: '⚒️', baseCost: 18_000,  costGrowth: 1.22, baseProd: 240 },
    castle:     { name: 'Château',    icon: '🏰', baseCost: 95_000,  costGrowth: 1.23, baseProd: 1_000 },
  });

/** Village names, cycled with the numeric tier for deeper villages. */
export const VILLAGE_NAMES: readonly string[] = [
  'Hameau',
  'Village',
  'Bourg',
  'Cité',
  'Forteresse',
  'Royaume',
  'Empire',
  'Cité légendaire',
];

/** Permanent global production multiplier gained per village beyond the first. */
const VILLAGE_GROWTH = 1.7;

export class VillageEngine {
  /** Cost to upgrade `type` from its current level to the next. */
  public static getBuildingCost(type: BuildingType, level: number): number {
    const cfg = BUILDING_CONFIGS[type];
    const safeLevel = VillageEngine.clampLevel(level);
    return Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, safeLevel));
  }

  /** Levels between milestones; each milestone doubles a building's output. */
  public static readonly MILESTONE_EVERY = 25;

  /** Milestone multiplier for a building at `level`: 2^floor(level/25). */
  public static getBuildingMultiplier(level: number): number {
    return Math.pow(2, Math.floor(VillageEngine.clampLevel(level) / VillageEngine.MILESTONE_EVERY));
  }

  /** Levels remaining until this building's next milestone (×2) bonus. */
  public static levelsToNextMilestone(level: number): number {
    const l = VillageEngine.clampLevel(level);
    return VillageEngine.MILESTONE_EVERY - (l % VillageEngine.MILESTONE_EVERY);
  }

  /**
   * Base gold/second produced by `type` at `level`, including its milestone
   * multiplier (no global multipliers).
   */
  public static getBuildingProduction(type: BuildingType, level: number): number {
    const l = VillageEngine.clampLevel(level);
    return BUILDING_CONFIGS[type].baseProd * l * VillageEngine.getBuildingMultiplier(l);
  }

  /** Total cost to buy `count` consecutive levels of `type` from `fromLevel`. */
  public static getBulkCost(type: BuildingType, fromLevel: number, count: number): number {
    const cfg = BUILDING_CONFIGS[type];
    const start = VillageEngine.clampLevel(fromLevel);
    const n = Math.max(0, Math.floor(count));
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, start + i));
    }
    return total;
  }

  /**
   * Largest number of consecutive levels of `type` affordable with `gold`
   * from `fromLevel`, plus their total cost. Iteration is capped for safety.
   */
  public static getMaxAffordable(
    type: BuildingType,
    fromLevel: number,
    gold: number,
  ): { count: number; cost: number } {
    const cfg = BUILDING_CONFIGS[type];
    const start = VillageEngine.clampLevel(fromLevel);
    const budget = Number.isFinite(gold) && gold > 0 ? gold : 0;
    let count = 0;
    let cost = 0;
    while (count < 100_000) {
      const next = Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, start + count));
      if (cost + next > budget) break;
      cost += next;
      count += 1;
    }
    return { count, cost };
  }

  /** Sum of all building levels in the profile. */
  public static getTotalLevels(state: UserProfile): number {
    let total = 0;
    for (const type of BUILDING_TYPES) {
      total += VillageEngine.clampLevel(state.buildings[type]);
    }
    return total;
  }

  /**
   * Total building levels required to advance *out of* `village` into the
   * next one. Grows super-linearly so each village is a longer haul.
   */
  public static getRequiredLevels(village: number): number {
    const v = Math.max(1, VillageEngine.clampLevel(village));
    return Math.round(18 * v + 6 * v * v);
  }

  /** True when the player has enough total building levels to advance. */
  public static canAdvance(state: UserProfile): boolean {
    return VillageEngine.getTotalLevels(state) >= VillageEngine.getRequiredLevels(state.village);
  }

  /** Progress in [0, 1] toward the next village. */
  public static getAdvanceProgress(state: UserProfile): number {
    const req = VillageEngine.getRequiredLevels(state.village);
    if (req <= 0) {
      return 1;
    }
    return Math.min(1, VillageEngine.getTotalLevels(state) / req);
  }

  /** Permanent global gold multiplier from the current village: 1.7^(v-1). */
  public static getVillageMultiplier(village: number): number {
    return Math.pow(VILLAGE_GROWTH, Math.max(0, VillageEngine.clampLevel(village) - 1));
  }

  /** Display name for a village, e.g. "Bourg" or "Hameau ✦2" past the list. */
  public static getVillageName(village: number): string {
    const v = Math.max(1, VillageEngine.clampLevel(village));
    const base = VILLAGE_NAMES[(v - 1) % VILLAGE_NAMES.length];
    const cycle = Math.floor((v - 1) / VILLAGE_NAMES.length);
    return cycle > 0 ? `${base} ✦${cycle + 1}` : base;
  }

  private static clampLevel(level: number): number {
    if (!Number.isFinite(level) || level < 0) {
      return 0;
    }
    return Math.floor(level);
  }
}
