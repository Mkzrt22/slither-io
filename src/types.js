/**
 * types.ts — Domain Types & Interfaces (Lucky Dungeon Tycoon)
 *
 * Pure domain layer: no imports, no side effects. Every other module in the
 * architecture depends on this file; this file depends on nothing.
 */
export const MINER_TIERS = [
    'goblin',
    'skeleton',
    'golem',
    'dragon',
];
export const BUILDING_TYPES = [
    'mine',
    'farm',
    'sawmill',
    'market',
    'blacksmith',
    'castle',
];
/** Canonical default configuration used by the engines below. */
export const DEFAULT_GAME_CONFIG = Object.freeze({
    baseGoldCost: 100,
    goldMultiplier: 1.62,
    baseGoldGain: 10,
    gainMultiplier: 1.45,
    energyRegenTimeSeconds: 300,
});
/** Maximum number of shields a player may stockpile. */
export const MAX_SHIELDS = 3;
/** Empty miner roster (all tiers at zero). */
export function createEmptyMiners() {
    return { goblin: 0, skeleton: 0, golem: 0, dragon: 0 };
}
/** Empty building roster (all levels at zero). */
export function createEmptyBuildings() {
    return { mine: 0, farm: 0, sawmill: 0, market: 0, blacksmith: 0, castle: 0 };
}
/** Zeroed lifetime counters. */
export function createEmptyStats() {
    return {
        goldEarnedRun: 0,
        goldEarnedAll: 0,
        totalSpins: 0,
        bossesKilled: 0,
        prestiges: 0,
    };
}
/**
 * Creates a brand-new, fully valid profile for a first-session player.
 * Centralised here so every layer (storage, tests, tooling) initialises
 * players identically.
 */
export function createDefaultProfile(now = Date.now()) {
    return {
        id: generateProfileId(),
        gold: 0,
        gems: 25,
        energy: 30,
        maxEnergy: 30,
        dungeonLevel: 0,
        shields: 0,
        floor: 1,
        bossHp: null,
        village: 1,
        buildings: createEmptyBuildings(),
        miners: createEmptyMiners(),
        relics: 0,
        boostEndsAt: 0,
        lastDailyClaim: 0,
        dailyStreak: 0,
        stats: createEmptyStats(),
        claimedQuests: [],
        lastSaveTimestamp: now,
    };
}
/**
 * Collision-resistant id without a crypto dependency: epoch millis plus two
 * base-36 random segments (~62 bits of entropy total).
 */
function generateProfileId() {
    const rand = () => Math.random().toString(36).slice(2, 10);
    return `ldt_${Date.now().toString(36)}_${rand()}${rand()}`;
}
/**
 * Returns a deep copy of a profile, field by field, so the compiler forces
 * this function to be updated whenever the profile shape changes.
 */
export function cloneProfile(state) {
    return {
        id: state.id,
        gold: state.gold,
        gems: state.gems,
        energy: state.energy,
        maxEnergy: state.maxEnergy,
        dungeonLevel: state.dungeonLevel,
        shields: state.shields,
        floor: state.floor,
        bossHp: state.bossHp,
        village: state.village,
        buildings: {
            mine: state.buildings.mine,
            farm: state.buildings.farm,
            sawmill: state.buildings.sawmill,
            market: state.buildings.market,
            blacksmith: state.buildings.blacksmith,
            castle: state.buildings.castle,
        },
        miners: {
            goblin: state.miners.goblin,
            skeleton: state.miners.skeleton,
            golem: state.miners.golem,
            dragon: state.miners.dragon,
        },
        relics: state.relics,
        boostEndsAt: state.boostEndsAt,
        lastDailyClaim: state.lastDailyClaim,
        dailyStreak: state.dailyStreak,
        stats: {
            goldEarnedRun: state.stats.goldEarnedRun,
            goldEarnedAll: state.stats.goldEarnedAll,
            totalSpins: state.stats.totalSpins,
            bossesKilled: state.stats.bossesKilled,
            prestiges: state.stats.prestiges,
        },
        claimedQuests: [...state.claimedQuests],
        lastSaveTimestamp: state.lastSaveTimestamp,
    };
}
/**
 * Credits gold to a profile, updating the lifetime counters that quests and
 * prestige read. Every gold *gain* in the game must flow through here;
 * steals/penalties debit `gold` directly and never touch the counters.
 */
export function creditGold(state, amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
        return;
    }
    state.gold += amount;
    state.stats.goldEarnedRun += amount;
    state.stats.goldEarnedAll += amount;
}
