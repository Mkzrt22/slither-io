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
import { BUILDING_TYPES } from './types.js';
export const BUILDING_CONFIGS = Object.freeze({
    mine: { name: 'Mine d’or', icon: '⛏️', baseCost: 30, costGrowth: 1.18, baseProd: 1 },
    farm: { name: 'Ferme', icon: '🌾', baseCost: 130, costGrowth: 1.19, baseProd: 4 },
    sawmill: { name: 'Scierie', icon: '🪵', baseCost: 700, costGrowth: 1.20, baseProd: 16 },
    market: { name: 'Marché', icon: '🏪', baseCost: 3500, costGrowth: 1.21, baseProd: 60 },
    blacksmith: { name: 'Forge', icon: '⚒️', baseCost: 18000, costGrowth: 1.22, baseProd: 240 },
    castle: { name: 'Château', icon: '🏰', baseCost: 95000, costGrowth: 1.23, baseProd: 1000 },
});
/** Village names, cycled with the numeric tier for deeper villages. */
export const VILLAGE_NAMES = [
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
    static getBuildingCost(type, level) {
        const cfg = BUILDING_CONFIGS[type];
        const safeLevel = VillageEngine.clampLevel(level);
        return Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, safeLevel));
    }
    /** Base gold/second produced by `type` at `level` (no global multipliers). */
    static getBuildingProduction(type, level) {
        return BUILDING_CONFIGS[type].baseProd * VillageEngine.clampLevel(level);
    }
    /** Sum of all building levels in the profile. */
    static getTotalLevels(state) {
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
    static getRequiredLevels(village) {
        const v = Math.max(1, VillageEngine.clampLevel(village));
        return Math.round(18 * v + 6 * v * v);
    }
    /** True when the player has enough total building levels to advance. */
    static canAdvance(state) {
        return VillageEngine.getTotalLevels(state) >= VillageEngine.getRequiredLevels(state.village);
    }
    /** Progress in [0, 1] toward the next village. */
    static getAdvanceProgress(state) {
        const req = VillageEngine.getRequiredLevels(state.village);
        if (req <= 0) {
            return 1;
        }
        return Math.min(1, VillageEngine.getTotalLevels(state) / req);
    }
    /** Permanent global gold multiplier from the current village: 1.7^(v-1). */
    static getVillageMultiplier(village) {
        return Math.pow(VILLAGE_GROWTH, Math.max(0, VillageEngine.clampLevel(village) - 1));
    }
    /** Display name for a village, e.g. "Bourg" or "Hameau ✦2" past the list. */
    static getVillageName(village) {
        const v = Math.max(1, VillageEngine.clampLevel(village));
        const base = VILLAGE_NAMES[(v - 1) % VILLAGE_NAMES.length];
        const cycle = Math.floor((v - 1) / VILLAGE_NAMES.length);
        return cycle > 0 ? `${base} ✦${cycle + 1}` : base;
    }
    static clampLevel(level) {
        if (!Number.isFinite(level) || level < 0) {
            return 0;
        }
        return Math.floor(level);
    }
}
