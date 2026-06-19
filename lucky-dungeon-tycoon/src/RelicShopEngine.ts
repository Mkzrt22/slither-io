/**
 * RelicShopEngine.ts — Prestige Relic Shop (Lucky Dungeon Tycoon).
 *
 * Relics earned through Ascension can be spent on a small set of *permanent*
 * upgrades that survive every future prestige. Each upgrade hooks one existing
 * multiplier point in the economy, so the shop deepens the prestige loop
 * without adding a parallel currency or balance system.
 *
 * Stateless and pure; the controller owns the spend transaction.
 */

import { UserProfile } from './types.js';

/** Where a relic upgrade applies its bonus. */
export type RelicEffect = 'gold' | 'slot' | 'boss' | 'offline';

export interface RelicUpgradeDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Which multiplier this upgrade feeds. */
  effect: RelicEffect;
  /** Additive bonus per level, as a fraction (0.06 = +6%). */
  perLevel: number;
  /** Relic cost of the first level. */
  baseCost: number;
  /** Geometric cost growth per level already owned. */
  costGrowth: number;
  /** Hard cap on levels. */
  maxLevel: number;
}

/** The relic shop catalogue, in display order. */
export const RELIC_UPGRADES: readonly RelicUpgradeDef[] = [
  {
    id: 'fortune',
    name: 'Fortune ancestrale',
    icon: '🪙',
    description: 'Production globale',
    effect: 'gold',
    perLevel: 0.06,
    baseCost: 1,
    costGrowth: 1.6,
    maxLevel: 30,
  },
  {
    id: 'butin',
    name: 'Veine d’or',
    icon: '🎰',
    description: 'Gains de la machine à sous',
    effect: 'slot',
    perLevel: 0.08,
    baseCost: 2,
    costGrowth: 1.7,
    maxLevel: 20,
  },
  {
    id: 'frappe',
    name: 'Lame éternelle',
    icon: '⚔️',
    description: 'Dégâts infligés aux boss',
    effect: 'boss',
    perLevel: 0.1,
    baseCost: 2,
    costGrowth: 1.7,
    maxLevel: 20,
  },
  {
    id: 'eveil',
    name: 'Œil nocturne',
    icon: '🌙',
    description: 'Gains hors-ligne',
    effect: 'offline',
    perLevel: 0.05,
    baseCost: 3,
    costGrowth: 1.8,
    maxLevel: 15,
  },
];

const UPGRADE_BY_ID: ReadonlyMap<string, RelicUpgradeDef> = new Map(
  RELIC_UPGRADES.map((u) => [u.id, u]),
);

export class RelicShopEngine {
  /** Upgrade definition by id, or undefined for unknown ids. */
  public static getUpgrade(id: string): RelicUpgradeDef | undefined {
    return UPGRADE_BY_ID.get(id);
  }

  /** Current owned level of an upgrade (0 when unowned or unknown). */
  public static getLevel(state: UserProfile, id: string): number {
    const raw = state.relicUpgrades[id];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      return 0;
    }
    return Math.floor(raw);
  }

  /** True when the upgrade is owned at its maximum level. */
  public static isMaxed(state: UserProfile, id: string): boolean {
    const def = RelicShopEngine.getUpgrade(id);
    return def !== undefined && RelicShopEngine.getLevel(state, id) >= def.maxLevel;
  }

  /**
   * Relic cost of the next level, or null when the upgrade is maxed or
   * unknown. Cost: round(baseCost * costGrowth^level).
   */
  public static getCost(state: UserProfile, id: string): number | null {
    const def = RelicShopEngine.getUpgrade(id);
    if (def === undefined) {
      return null;
    }
    const level = RelicShopEngine.getLevel(state, id);
    if (level >= def.maxLevel) {
      return null;
    }
    return Math.max(1, Math.round(def.baseCost * Math.pow(def.costGrowth, level)));
  }

  /** True when the next level exists and the player can pay for it. */
  public static canAfford(state: UserProfile, id: string): boolean {
    const cost = RelicShopEngine.getCost(state, id);
    return cost !== null && state.relics >= cost;
  }

  /**
   * Buys one level of `id`, mutating `state` in place: deducts relics and
   * raises the upgrade level. Returns true on success, false when maxed,
   * unknown, or unaffordable.
   */
  public static purchase(state: UserProfile, id: string): boolean {
    const cost = RelicShopEngine.getCost(state, id);
    if (cost === null || state.relics < cost) {
      return false;
    }
    state.relics -= cost;
    state.relicUpgrades[id] = RelicShopEngine.getLevel(state, id) + 1;
    return true;
  }

  /** Combined additive bonus (as a fraction) across upgrades of one effect. */
  private static bonus(state: UserProfile, effect: RelicEffect): number {
    let total = 0;
    for (const def of RELIC_UPGRADES) {
      if (def.effect === effect) {
        total += def.perLevel * RelicShopEngine.getLevel(state, def.id);
      }
    }
    return total;
  }

  /** Permanent global production multiplier from relic upgrades (>= 1). */
  public static getGoldMultiplier(state: UserProfile): number {
    return 1 + RelicShopEngine.bonus(state, 'gold');
  }

  /** Permanent slot-payout multiplier from relic upgrades (>= 1). */
  public static getSlotMultiplier(state: UserProfile): number {
    return 1 + RelicShopEngine.bonus(state, 'slot');
  }

  /** Permanent boss-damage multiplier from relic upgrades (>= 1). */
  public static getBossMultiplier(state: UserProfile): number {
    return 1 + RelicShopEngine.bonus(state, 'boss');
  }

  /** Permanent offline-earnings multiplier from relic upgrades (>= 1). */
  public static getOfflineMultiplier(state: UserProfile): number {
    return 1 + RelicShopEngine.bonus(state, 'offline');
  }

  /** Human description of an upgrade's current effect, for the UI. */
  public static effectText(def: RelicUpgradeDef, level: number): string {
    const pct = Math.round(def.perLevel * Math.max(0, level) * 100);
    return `${def.description} +${pct}%`;
  }
}
