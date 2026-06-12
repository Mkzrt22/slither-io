/**
 * types.ts — Domain Types & Interfaces (Lucky Dungeon Tycoon)
 *
 * Pure domain layer: no imports, no side effects. Every other module in the
 * architecture depends on this file; this file depends on nothing.
 */
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
 * Returns a deep copy of a profile. UserProfile is intentionally flat, so a
 * field-by-field copy is both exhaustive and cheap. If a field is ever added
 * to UserProfile, the compiler forces this function to be updated.
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
        lastSaveTimestamp: state.lastSaveTimestamp,
    };
}
