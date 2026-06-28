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
export const RECIPE_IDS = [
    'fast_food_burger', 'bento_box', 'gourmet_lobster', 'experimental_molecular',
];
export const STATION_IDS = [
    'receiving',
    'prep',
    'cooking',
    'plating',
    'delivery',
];
/** A fresh, fully-built starter line so money flows from the first second. */
export function createDefaultFactory(now = Date.now()) {
    const station = (level) => ({ level, workers: 0, output: 0 });
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
export function cloneFactory(s) {
    const st = (x) => ({ level: x.level, workers: x.workers, output: x.output });
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
function generateId() {
    const rand = () => Math.random().toString(36).slice(2, 10);
    return `fct_${Date.now().toString(36)}_${rand()}${rand()}`;
}
