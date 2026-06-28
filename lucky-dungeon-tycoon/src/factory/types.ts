/**
 * types.ts — Domain model for the food-factory production simulation.
 *
 * This is a real flow simulation, not a slot machine: raw ingredients are
 * pulled through an ordered line of stations (receiving → prep → cooking →
 * plating → delivery). Each station processes its input into output at a
 * cadence, with finite buffers, so the line's earnings are gated by its
 * slowest station — the bottleneck the player hunts and upgrades.
 *
 * Pure data + factory functions. No imports, no side effects.
 */

/** Ordered station ids of a single production line (receiving first). */
export type StationId =
  | 'receiving'
  | 'prep'
  | 'cooking'
  | 'plating'
  | 'delivery';

/** Switchable products. Pricier recipes are more complex (slower per station). */
export type RecipeId = 'fast_food_burger' | 'bento_box' | 'gourmet_lobster' | 'experimental_molecular';

export const RECIPE_IDS: readonly RecipeId[] = [
  'fast_food_burger', 'bento_box', 'gourmet_lobster', 'experimental_molecular',
];

export const STATION_IDS: readonly StationId[] = [
  'receiving',
  'prep',
  'cooking',
  'plating',
  'delivery',
];

/** Per-station mutable state. */
export interface StationState {
  /** Upgrade level (>= 1 once built; drives base cadence & buffer size). */
  level: number;
  /** Workers assigned here (each adds a cadence bonus). */
  workers: number;
  /** Units sitting in this station's output buffer, waiting downstream. */
  output: number;
}

/** Lifetime counters driving prestige, quests, and the stats panel. */
export interface FactoryStats {
  /** Cash earned this prestige run (resets on prestige). */
  cashRun: number;
  /** Cash earned across all runs (never resets — the cloud-save score). */
  cashAll: number;
  /** Dishes sold across all runs. */
  dishesSold: number;
  /** Number of prestiges performed. */
  prestiges: number;
}

/**
 * Persisted factory profile — the single source of truth. JSON-serialisable
 * so it round-trips through the same base64 backup-code path the backend
 * already stores.
 */
export interface FactoryState {
  /** Schema id, so loaders can distinguish this from legacy saves. */
  kind: 'factory';
  /** Schema version for forward migrations. */
  version: number;
  /** Stable player id. */
  id: string;

  /** Soft currency (euros) from sales. */
  cash: number;
  /** Hard premium currency. */
  gems: number;
  /** Prestige currency (Michelin stars) — permanent global multiplier. */
  stars: number;

  /** Per-station state, keyed by station id. */
  stations: Record<StationId, StationState>;
  /** The dish currently in production (drives value + per-station complexity). */
  activeRecipeId: RecipeId;
  /** Recipes the player has unlocked (always includes the starter). */
  unlockedRecipes: RecipeId[];
  /** Menu tier: raises € earned per dish sold. */
  menuLevel: number;
  /** Idle pool of hired workers not yet assigned to a station. */
  workersIdle: number;
  /** Total workers ever hired (assigned + idle), for hire-cost scaling. */
  workersHired: number;

  /** Permanent research levels, keyed by research id (absent = 0). */
  research: Record<string, number>;

  /** Epoch ms when an active ×N production rush ends (0 = none). */
  rushEndsAt: number;
  /** Epoch ms of the last claimed daily reward (0 = never). */
  lastDailyClaim: number;
  /** Current daily-reward streak. */
  dailyStreak: number;

  /** Lifetime counters. */
  stats: FactoryStats;
  /** Unix epoch ms of the last persisted save (drives offline accrual). */
  lastSaveAt: number;
}

/** A fresh, fully-built starter line so money flows from the first second. */
export function createDefaultFactory(now: number = Date.now()): FactoryState {
  const station = (level: number): StationState => ({ level, workers: 0, output: 0 });
  return {
    kind: 'factory',
    version: 1,
    id: generateId(),
    cash: 0,
    gems: 25,
    stars: 0,
    stations: {
      receiving: station(1),
      prep: station(1),
      cooking: station(1),
      plating: station(1),
      delivery: station(1),
    },
    activeRecipeId: 'fast_food_burger',
    unlockedRecipes: ['fast_food_burger'],
    menuLevel: 0,
    workersIdle: 0,
    workersHired: 0,
    research: {},
    rushEndsAt: 0,
    lastDailyClaim: 0,
    dailyStreak: 0,
    stats: { cashRun: 0, cashAll: 0, dishesSold: 0, prestiges: 0 },
    lastSaveAt: now,
  };
}

/** Deep clone, field by field, so the compiler flags shape changes. */
export function cloneFactory(s: FactoryState): FactoryState {
  const st = (x: StationState): StationState => ({ level: x.level, workers: x.workers, output: x.output });
  return {
    kind: 'factory',
    version: s.version,
    id: s.id,
    cash: s.cash,
    gems: s.gems,
    stars: s.stars,
    stations: {
      receiving: st(s.stations.receiving),
      prep: st(s.stations.prep),
      cooking: st(s.stations.cooking),
      plating: st(s.stations.plating),
      delivery: st(s.stations.delivery),
    },
    activeRecipeId: s.activeRecipeId,
    unlockedRecipes: [...s.unlockedRecipes],
    menuLevel: s.menuLevel,
    workersIdle: s.workersIdle,
    workersHired: s.workersHired,
    research: { ...s.research },
    rushEndsAt: s.rushEndsAt,
    lastDailyClaim: s.lastDailyClaim,
    dailyStreak: s.dailyStreak,
    stats: { ...s.stats },
    lastSaveAt: s.lastSaveAt,
  };
}

function generateId(): string {
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `fct_${Date.now().toString(36)}_${rand()}${rand()}`;
}
