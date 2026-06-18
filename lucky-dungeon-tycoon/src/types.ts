/**
 * types.ts — Domain Types & Interfaces (Lucky Dungeon Tycoon)
 *
 * Pure domain layer: no imports, no side effects. Every other module in the
 * architecture depends on this file; this file depends on nothing.
 */

/** The four hireable passive-income units, cheapest first. */
export type MinerTier = 'goblin' | 'skeleton' | 'golem' | 'dragon';

export const MINER_TIERS: readonly MinerTier[] = [
  'goblin',
  'skeleton',
  'golem',
  'dragon',
];

/** The six upgradeable village buildings, cheapest first. */
export type BuildingType =
  | 'mine'
  | 'farm'
  | 'sawmill'
  | 'market'
  | 'blacksmith'
  | 'castle';

export const BUILDING_TYPES: readonly BuildingType[] = [
  'mine',
  'farm',
  'sawmill',
  'market',
  'blacksmith',
  'castle',
];

/** Lifetime counters driving quests and prestige math. */
export interface PlayerStats {
  /** Gold earned during the current prestige run (resets on ascension). */
  goldEarnedRun: number;
  /** Gold earned across all runs (never resets). */
  goldEarnedAll: number;
  totalSpins: number;
  bossesKilled: number;
  prestiges: number;
}

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
  /** Current spin energy. Integer >= 0 (may overfill past maxEnergy). */
  energy: number;
  /** Energy soft cap for regeneration. Integer >= 1. */
  maxEnergy: number;
  /** Spin-gain upgrade level (drives the base payout curve). */
  dungeonLevel: number;
  /** Raid-blocking shields. Integer in [0, MAX_SHIELDS]. */
  shields: number;
  /** Current dungeon floor (>= 1). Scales payouts and boss difficulty. */
  floor: number;
  /** Remaining HP of the boss being fought, or null when not fighting. */
  bossHp: number | null;
  /** Current village (>= 1). Scales global production and theme. */
  village: number;
  /** Upgrade level of each village building (0 = not built). */
  buildings: Record<BuildingType, number>;
  /** Hired passive-income units per tier (legacy income source). */
  miners: Record<MinerTier, number>;
  /** Prestige currency: each relic grants a permanent gold multiplier. */
  relics: number;
  /** Epoch ms when the active production Rush boost ends (0 = no boost). */
  boostEndsAt: number;
  /** Epoch ms of the last claimed daily reward (0 = never). */
  lastDailyClaim: number;
  /** Current consecutive-day streak for the daily reward. */
  dailyStreak: number;
  /** Lifetime counters for quests/prestige. */
  stats: PlayerStats;
  /** Ids of quests whose reward has been collected. */
  claimedQuests: string[];
  /** Unix epoch milliseconds of the last persisted save. */
  lastSaveTimestamp: number;
}

/** The six slot-machine reel symbols. */
export type SlotSymbol = 'COIN' | 'BAG' | 'GEM' | 'SHIELD' | 'SWORD' | 'SKULL';

/** How the three reels combined. */
export type SlotOutcome = 'JACKPOT' | 'PAIR' | 'SCATTER';

/**
 * Immutable record describing the outcome of one 3-reel spin. `stateSnapshot`
 * is a deep copy of the profile *after* the spin resolved, so the View layer
 * renders results without reaching into mutable model state.
 */
export interface SlotSpinResult {
  symbols: [SlotSymbol, SlotSymbol, SlotSymbol];
  outcome: SlotOutcome;
  /** Gold credited by this spin (after multipliers, before skull steals). */
  goldGained: number;
  /** Gold lost to a skull event during this spin (0 when none). */
  goldStolen: number;
  gemsGained: number;
  shieldsGained: number;
  /** Damage dealt to the active boss (0 when not fighting or no swords). */
  bossDamage: number;
  /** Human-readable one-line description for the event log. */
  label: string;
  energyConsumed: number;
  timestamp: number;
  stateSnapshot: UserProfile;
}

/** Legacy single-roll result kept for the v1 SpinEngine API. */
export type SpinResultType = 'GOLD_MIN' | 'GOLD_MAJ' | 'SHIELD' | 'RAID';

export interface SpinResult {
  type: SpinResultType;
  value: number;
  energyConsumed: number;
  timestamp: number;
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

/** Empty miner roster (all tiers at zero). */
export function createEmptyMiners(): Record<MinerTier, number> {
  return { goblin: 0, skeleton: 0, golem: 0, dragon: 0 };
}

/** Empty building roster (all levels at zero). */
export function createEmptyBuildings(): Record<BuildingType, number> {
  return { mine: 0, farm: 0, sawmill: 0, market: 0, blacksmith: 0, castle: 0 };
}

/** Zeroed lifetime counters. */
export function createEmptyStats(): PlayerStats {
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
export function createDefaultProfile(now: number = Date.now()): UserProfile {
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
function generateProfileId(): string {
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `ldt_${Date.now().toString(36)}_${rand()}${rand()}`;
}

/**
 * Returns a deep copy of a profile, field by field, so the compiler forces
 * this function to be updated whenever the profile shape changes.
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
export function creditGold(state: UserProfile, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  state.gold += amount;
  state.stats.goldEarnedRun += amount;
  state.stats.goldEarnedAll += amount;
}
