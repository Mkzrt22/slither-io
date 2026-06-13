/**
 * EconomyEngine.ts — Mathematical Core (Lucky Dungeon Tycoon)
 *
 * Stateless, purely functional math layer: geometric cost/gain curves and the
 * idle-genre short-scale currency formatter. All functions are total — every
 * numeric input (including NaN, ±Infinity and negatives) produces a defined,
 * non-throwing result, because UI render paths must never crash on bad data.
 */
import { DEFAULT_GAME_CONFIG, MINER_TIERS } from './types.js';
export const MINER_CONFIGS = Object.freeze({
    goblin: { name: 'Mineur gobelin', baseCost: 50, costGrowth: 1.15, baseRate: 1 },
    skeleton: { name: 'Fossoyeur squelette', baseCost: 600, costGrowth: 1.17, baseRate: 9 },
    golem: { name: 'Golem de forage', baseCost: 8000, costGrowth: 1.19, baseRate: 65 },
    dragon: { name: 'Dragon thésauriseur', baseCost: 110000, costGrowth: 1.21, baseRate: 420 },
});
/** Gold multiplier gained per dungeon floor beyond the first. */
const FLOOR_GOLD_GROWTH = 1.3;
/** Permanent gold multiplier granted by each prestige relic. */
const RELIC_BONUS = 0.1;
/** Boss HP at floor 1; grows faster than gold so upgrades stay relevant. */
const BOSS_BASE_HP = 300;
const BOSS_HP_GROWTH = 2.2;
/** Gold-earned-this-run required before ascension unlocks. */
export const PRESTIGE_THRESHOLD = 1000000;
export class EconomyEngine {
    /**
     * Cost of upgrading from `level` to `level + 1`.
     * Formula: 100 * 1.62^level, rounded to the nearest integer so displayed
     * prices are always whole numbers. Negative or non-finite levels are
     * clamped to 0, which yields the base cost.
     */
    static getUpgradeCost(level) {
        const safeLevel = EconomyEngine.sanitizeLevel(level);
        return Math.round(DEFAULT_GAME_CONFIG.baseGoldCost *
            Math.pow(DEFAULT_GAME_CONFIG.goldMultiplier, safeLevel));
    }
    /**
     * Base gold gain of a minor win at `level`.
     * Formula: 10 * 1.45^level, rounded to the nearest integer. Negative or
     * non-finite levels are clamped to 0.
     */
    static getBaseGain(level) {
        const safeLevel = EconomyEngine.sanitizeLevel(level);
        return Math.round(DEFAULT_GAME_CONFIG.baseGoldGain *
            Math.pow(DEFAULT_GAME_CONFIG.gainMultiplier, safeLevel));
    }
    /**
     * Idle Short Scale Formatter.
     *
     *   1,234            -> "1.23K"
     *   1,250,000        -> "1.25M"
     *   5,400,000,000,000-> "5.40T"
     *   999              -> "999"
     *   -1,250,000       -> "-1.25M"
     *
     * Behaviour contract:
     *  - Values with |v| < 1000 render as a whole number (no suffix).
     *  - Suffixed values always carry exactly two decimals, truncated (never
     *    rounded up) so the UI never overstates the player's wealth — and so
     *    999,999 renders as "999.99K", not the impossible "1000.00K".
     *  - Beyond the Dc tier (>= 10^36) the formatter falls back to scientific
     *    notation, which keeps arbitrarily inflated late-game values readable.
     *  - NaN renders as "0"; ±Infinity renders as "∞"/"-∞".
     */
    static formatCurrency(value) {
        if (Number.isNaN(value)) {
            return '0';
        }
        if (value === Infinity) {
            return '∞';
        }
        if (value === -Infinity) {
            return '-∞';
        }
        const sign = value < 0 ? '-' : '';
        const abs = Math.abs(value);
        if (abs < 1000) {
            return sign + Math.floor(abs).toString();
        }
        // Power-of-1000 tier. log10 of a float can land epsilon-low on exact
        // boundaries (e.g. log10(1e21) -> 20.999...), so verify the tier against
        // the actual magnitude and correct by one step where needed.
        let tier = Math.floor(Math.log10(abs) / 3);
        if (abs >= Math.pow(10, (tier + 1) * 3)) {
            tier += 1;
        }
        else if (abs < Math.pow(10, tier * 3)) {
            tier -= 1;
        }
        if (tier >= EconomyEngine.SUFFIXES.length) {
            return sign + abs.toExponential(2);
        }
        const scaled = abs / Math.pow(10, tier * 3);
        // Truncate (not round) to two decimals; clamp guards float artifacts
        // such as 999.9999999 scaling to a 1000.00 display value.
        const truncated = Math.min(Math.floor(scaled * 100) / 100, 999.99);
        return sign + truncated.toFixed(2) + EconomyEngine.SUFFIXES[tier];
    }
    // -------------------------------------------------------------------------
    // v2 economy: floors, relics, miners, bosses, prestige
    // -------------------------------------------------------------------------
    /** Gold multiplier from the current floor: 1.3^(floor-1). */
    static getFloorMultiplier(floor) {
        const safeFloor = Math.max(1, EconomyEngine.sanitizeLevel(floor));
        return Math.pow(FLOOR_GOLD_GROWTH, safeFloor - 1);
    }
    /** Permanent gold multiplier from prestige relics: 1 + 0.1/relic. */
    static getRelicMultiplier(relics) {
        return 1 + RELIC_BONUS * EconomyEngine.sanitizeLevel(relics);
    }
    /** Combined global gold multiplier for a profile. */
    static getGlobalMultiplier(state) {
        return (EconomyEngine.getFloorMultiplier(state.floor) *
            EconomyEngine.getRelicMultiplier(state.relics));
    }
    /** Cost of the next unit of `tier` given how many are already owned. */
    static getMinerCost(tier, owned) {
        const cfg = MINER_CONFIGS[tier];
        return Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, EconomyEngine.sanitizeLevel(owned)));
    }
    /**
     * Total passive income in gold/second for a profile, with floor and relic
     * multipliers applied.
     */
    static getPassiveRate(state) {
        let rate = 0;
        for (const tier of MINER_TIERS) {
            rate += MINER_CONFIGS[tier].baseRate * Math.max(0, state.miners[tier]);
        }
        return rate * EconomyEngine.getGlobalMultiplier(state);
    }
    /** Max HP of the boss guarding `floor`: 300 * 2.2^(floor-1). */
    static getBossMaxHp(floor) {
        const safeFloor = Math.max(1, EconomyEngine.sanitizeLevel(floor));
        return Math.round(BOSS_BASE_HP * Math.pow(BOSS_HP_GROWTH, safeFloor - 1));
    }
    /** Gems found in the chest dropped by the boss of `floor`. */
    static getBossReward(floor) {
        return 3 + Math.max(1, EconomyEngine.sanitizeLevel(floor));
    }
    /**
     * Relics granted by ascending now: sub-linear in gold earned this run so
     * each prestige pushes the next threshold meaningfully further. Returns 0
     * when the run has not reached the prestige threshold.
     */
    static getPrestigeRelics(goldEarnedRun) {
        if (!Number.isFinite(goldEarnedRun) || goldEarnedRun < PRESTIGE_THRESHOLD) {
            return 0;
        }
        return Math.max(1, Math.floor(Math.pow(goldEarnedRun / PRESTIGE_THRESHOLD, 0.45)));
    }
    /** Clamps a level to a non-negative integer; non-finite input becomes 0. */
    static sanitizeLevel(level) {
        if (!Number.isFinite(level) || level < 0) {
            return 0;
        }
        return Math.floor(level);
    }
}
/**
 * Short-scale suffixes by power-of-1000 tier. Index 0 is the unit tier.
 * K=10^3 … Dc=10^33.
 */
EconomyEngine.SUFFIXES = [
    '',
    'K',
    'M',
    'B',
    'T',
    'Qa',
    'Qi',
    'Sx',
    'Sp',
    'Oc',
    'No',
    'Dc',
];
