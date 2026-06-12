/**
 * types.ts — Domain Types & Interfaces (Lucky Dungeon Tycoon)
 *
 * Pure domain layer: no imports, no side effects. Every other module in the
 * architecture depends on this file; this file depends on nothing.
 */

/**
 * The persisted player profile. This is the single source of truth for all
 * player-owned resources and progression state.
 */
export interface UserProfile {
  /** Stable unique identifier for the player. */
  id: string;
  /** Soft currency. Always a finite number >= 0. */
  gold: number;
  /** Hard (premium) currency. Always an integer >= 0. */
  gems: number;
  /** Current spin energy. Integer in [0, maxEnergy]. */
  energy: number;
  /** Energy cap. Integer >= 1. */
  maxEnergy: number;
  /** Current dungeon (upgrade) level. Integer >= 0. */
  dungeonLevel: number;
  /** Raid-blocking shields. Integer in [0, MAX_SHIELDS]. */
  shields: number;
  /** Unix epoch milliseconds of the last persisted save. */
  lastSaveTimestamp: number;
}

/** The four possible outcomes of a single slot-machine spin. */
export type SpinResultType = 'GOLD_MIN' | 'GOLD_MAJ' | 'SHIELD' | 'RAID';

/**
 * Immutable record describing the outcome of one spin. `stateSnapshot` is a
 * deep copy of the profile *after* the spin resolved, so the View layer can
 * render results without reaching back into mutable model state.
 */
export interface SpinResult {
  type: SpinResultType;
  /**
   * The primary numeric payout of the spin. For gold outcomes this is the
   * amount of gold granted; for a SHIELD outcome it is 1 when a shield was
   * granted, or the compensatory gold amount when shields were already full.
   */
  value: number;
  /** Energy spent to execute this spin (always 1 in the current design). */
  energyConsumed: number;
  /** Unix epoch milliseconds at which the spin resolved. */
  timestamp: number;
  /** Deep snapshot of the profile after the spin was applied. */
  stateSnapshot: UserProfile;
}

/** Tunable economy configuration (server-pushable in a live product). */
export interface GameConfig {
  /** Base cost of the level-0 dungeon upgrade. */
  baseGoldCost: number;
  /** Geometric growth factor applied to upgrade costs per level. */
  goldMultiplier: number;
  /** Base gold gain of a level-0 minor win. */
  baseGoldGain: number;
  /** Geometric growth factor applied to gains per level. */
  gainMultiplier: number;
  /** Seconds required to regenerate a single point of energy. */
  energyRegenTimeSeconds: number;
}

/** Canonical default configuration used by the engines below. */
export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = Object.freeze({
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
export function createDefaultProfile(now: number = Date.now()): UserProfile {
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
function generateProfileId(): string {
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `ldt_${Date.now().toString(36)}_${rand()}${rand()}`;
}

/**
 * Returns a deep copy of a profile. UserProfile is intentionally flat, so a
 * field-by-field copy is both exhaustive and cheap. If a field is ever added
 * to UserProfile, the compiler forces this function to be updated.
 */
export function cloneProfile(state: UserProfile): UserProfile {
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
