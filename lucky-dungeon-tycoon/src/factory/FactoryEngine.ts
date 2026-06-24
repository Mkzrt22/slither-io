/**
 * FactoryEngine.ts — The production-line simulation (pure & static).
 *
 * The tick pulls units downstream-first so a full buffer backs pressure up
 * the line, then the receiving station refills. The line's steady-state
 * throughput is its slowest station — the bottleneck — and money is made only
 * when finished dishes are sold at the delivery station. Every derived number
 * the UI shows (cadence, capacity, throughput, costs, prestige) is computed
 * here so the view stays dumb.
 */

import {
  BASE_DISH_PRICE, MENU_BASE_COST, MENU_COST_GROWTH, MENU_PRICE_GROWTH,
  OFFLINE_BASE_EFFICIENCY, OFFLINE_CAP_HOURS, PRESTIGE_BASE_THRESHOLD,
  RESEARCH_BY_ID, RESEARCH_DEFS, RUSH_MULTIPLIER, STAR_BONUS, STATION_DEFS,
  STATION_DEF_BY_ID, WORKERS_PER_STATION_CAP, WORKER_BASE_COST,
  WORKER_BOOST, WORKER_COST_GROWTH,
} from './config.js';
import { FactoryState, STATION_IDS, StationId, StationState } from './types.js';

/** Outcome of one tick: cash credited and dishes sold this step. */
export interface TickResult {
  cashEarned: number;
  dishesSold: number;
}

export class FactoryEngine {
  // --- Research helpers -------------------------------------------------------

  public static researchLevel(state: FactoryState, id: string): number {
    const raw = state.research[id];
    return typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 0;
  }

  private static researchBonus(state: FactoryState, effect: 'rate' | 'price' | 'offline' | 'buffer'): number {
    let total = 0;
    for (const def of RESEARCH_DEFS) {
      if (def.effect === effect) {
        total += def.perLevel * FactoryEngine.researchLevel(state, def.id);
      }
    }
    return total;
  }

  /** Permanent global production multiplier from prestige stars (>= 1). */
  public static starMultiplier(state: FactoryState): number {
    return 1 + STAR_BONUS * Math.max(0, Math.floor(state.stars));
  }

  /** Whether a production rush is active right now. */
  public static rushActive(state: FactoryState, now: number): boolean {
    return now < state.rushEndsAt;
  }

  /** Global cadence multiplier (stars × rate-research × active rush). */
  public static globalRateMultiplier(state: FactoryState, now: number): number {
    const rush = FactoryEngine.rushActive(state, now) ? RUSH_MULTIPLIER : 1;
    return FactoryEngine.starMultiplier(state) * (1 + FactoryEngine.researchBonus(state, 'rate')) * rush;
  }

  // --- Per-station derived values --------------------------------------------

  /** Effective cadence (units/sec) of a station, all multipliers included. */
  public static stationRate(state: FactoryState, id: StationId, now: number): number {
    const def = STATION_DEF_BY_ID[id];
    const st = state.stations[id];
    if (st.level <= 0) return 0;
    const workerMult = 1 + WORKER_BOOST * Math.min(st.workers, WORKERS_PER_STATION_CAP);
    return def.baseRate * st.level * workerMult * FactoryEngine.globalRateMultiplier(state, now);
  }

  /** Output-buffer capacity of a station (grows with level and research). */
  public static stationCapacity(state: FactoryState, id: StationId): number {
    const def = STATION_DEF_BY_ID[id];
    const st = state.stations[id];
    const bufferBonus = 1 + FactoryEngine.researchBonus(state, 'buffer');
    return Math.max(1, Math.round(def.baseBuffer * (1 + 0.2 * (st.level - 1)) * bufferBonus));
  }

  /** € paid per dish sold, including the menu tier and price research. */
  public static dishPrice(state: FactoryState): number {
    const menu = BASE_DISH_PRICE * Math.pow(MENU_PRICE_GROWTH, Math.max(0, state.menuLevel));
    return menu * (1 + FactoryEngine.researchBonus(state, 'price'));
  }

  /** Steady-state line throughput (units/sec) — the slowest station's rate. */
  public static lineThroughput(state: FactoryState, now: number): number {
    let min = Infinity;
    for (const id of STATION_IDS) {
      min = Math.min(min, FactoryEngine.stationRate(state, id, now));
    }
    return Number.isFinite(min) ? min : 0;
  }

  /** Index of the bottleneck station (slowest), for UI highlighting. */
  public static bottleneck(state: FactoryState, now: number): StationId {
    let best: StationId = STATION_IDS[0];
    let bestRate = Infinity;
    for (const id of STATION_IDS) {
      const r = FactoryEngine.stationRate(state, id, now);
      if (r < bestRate) { bestRate = r; best = id; }
    }
    return best;
  }

  /** Steady-state revenue per second (throughput × price). */
  public static revenuePerSecond(state: FactoryState, now: number): number {
    return FactoryEngine.lineThroughput(state, now) * FactoryEngine.dishPrice(state);
  }

  // --- The tick ---------------------------------------------------------------

  /**
   * Advances the simulation by `dt` seconds, mutating `state`. Flow is pulled
   * downstream-first: each station draws from its upstream neighbour's output
   * buffer (limited by its own cadence and free buffer space), the delivery
   * station sells what it processes, and finally receiving refills. Returns
   * the cash and dishes produced this step.
   */
  public static tick(state: FactoryState, dt: number, now: number): TickResult {
    if (!(dt > 0)) return { cashEarned: 0, dishesSold: 0 };
    const price = FactoryEngine.dishPrice(state);

    let dishesSold = 0;

    // Downstream-first: delivery, plating, cooking, prep (indices 4..1).
    for (let i = STATION_IDS.length - 1; i >= 1; i--) {
      const id = STATION_IDS[i];
      const prevId = STATION_IDS[i - 1];
      const st = state.stations[id];
      const prev = state.stations[prevId];
      const capacity = dt * FactoryEngine.stationRate(state, id, now);
      let move = Math.min(capacity, prev.output);
      if (i < STATION_IDS.length - 1) {
        // Mid stations push into their own (finite) output buffer.
        const free = FactoryEngine.stationCapacity(state, id) - st.output;
        move = Math.min(move, Math.max(0, free));
        st.output += move;
      } else {
        // Delivery sells immediately — no output buffer.
        dishesSold += move;
      }
      prev.output -= move;
    }

    // Receiving refills its own output buffer from the (infinite) supply.
    const recv = state.stations.receiving;
    const recvRate = dt * FactoryEngine.stationRate(state, 'receiving', now);
    const recvFree = FactoryEngine.stationCapacity(state, 'receiving') - recv.output;
    recv.output += Math.min(recvRate, Math.max(0, recvFree));

    const cashEarned = dishesSold * price;
    if (cashEarned > 0) {
      state.cash += cashEarned;
      state.stats.cashRun += cashEarned;
      state.stats.cashAll += cashEarned;
      state.stats.dishesSold += dishesSold;
    }
    return { cashEarned, dishesSold };
  }

  // --- Upgrades ---------------------------------------------------------------

  /** Cost to take a station from its current level to the next. */
  public static upgradeCost(state: FactoryState, id: StationId): number {
    const def = STATION_DEF_BY_ID[id];
    const level = Math.max(0, Math.floor(state.stations[id].level));
    return Math.round(def.upgradeBaseCost * Math.pow(def.upgradeGrowth, level));
  }

  /** Total cost to buy `count` consecutive station levels. */
  public static upgradeBulkCost(state: FactoryState, id: StationId, count: number): number {
    const def = STATION_DEF_BY_ID[id];
    const start = Math.max(0, Math.floor(state.stations[id].level));
    let total = 0;
    for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
      total += Math.round(def.upgradeBaseCost * Math.pow(def.upgradeGrowth, start + i));
    }
    return total;
  }

  /** Largest affordable run of station upgrades and its total cost. */
  public static maxAffordableUpgrades(state: FactoryState, id: StationId): { count: number; cost: number } {
    const def = STATION_DEF_BY_ID[id];
    const start = Math.max(0, Math.floor(state.stations[id].level));
    const budget = state.cash > 0 ? state.cash : 0;
    let count = 0;
    let cost = 0;
    while (count < 100_000) {
      const next = Math.round(def.upgradeBaseCost * Math.pow(def.upgradeGrowth, start + count));
      if (cost + next > budget) break;
      cost += next; count += 1;
    }
    return { count, cost };
  }

  /** Buys `count` levels of a station (or as many as affordable for 'max'). */
  public static buyUpgrade(state: FactoryState, id: StationId, mode: 1 | 10 | 'max'): number {
    const plan = mode === 'max'
      ? FactoryEngine.maxAffordableUpgrades(state, id)
      : { count: mode, cost: FactoryEngine.upgradeBulkCost(state, id, mode) };
    if (plan.count < 1 || state.cash < plan.cost) return 0;
    state.cash -= plan.cost;
    state.stations[id].level += plan.count;
    return plan.count;
  }

  // --- Workers ----------------------------------------------------------------

  /** Cost of the next worker (scales with total hired). */
  public static workerCost(state: FactoryState): number {
    return Math.round(WORKER_BASE_COST * Math.pow(WORKER_COST_GROWTH, Math.max(0, state.workersHired)));
  }

  /** Hires one worker into the idle pool. False when unaffordable. */
  public static hireWorker(state: FactoryState): boolean {
    const cost = FactoryEngine.workerCost(state);
    if (state.cash < cost) return false;
    state.cash -= cost;
    state.workersHired += 1;
    state.workersIdle += 1;
    return true;
  }

  /** Moves one idle worker onto a station (respecting the per-station cap). */
  public static assignWorker(state: FactoryState, id: StationId): boolean {
    if (state.workersIdle < 1) return false;
    if (state.stations[id].workers >= WORKERS_PER_STATION_CAP) return false;
    state.workersIdle -= 1;
    state.stations[id].workers += 1;
    return true;
  }

  /** Pulls one worker off a station back into the idle pool. */
  public static unassignWorker(state: FactoryState, id: StationId): boolean {
    if (state.stations[id].workers < 1) return false;
    state.stations[id].workers -= 1;
    state.workersIdle += 1;
    return true;
  }

  // --- Menu (dish price) ------------------------------------------------------

  public static menuCost(state: FactoryState): number {
    return Math.round(MENU_BASE_COST * Math.pow(MENU_COST_GROWTH, Math.max(0, state.menuLevel)));
  }

  public static buyMenu(state: FactoryState): boolean {
    const cost = FactoryEngine.menuCost(state);
    if (state.cash < cost) return false;
    state.cash -= cost;
    state.menuLevel += 1;
    return true;
  }

  // --- Research ---------------------------------------------------------------

  public static researchCost(state: FactoryState, id: string): number | null {
    const def = RESEARCH_BY_ID[id];
    if (!def) return null;
    const level = FactoryEngine.researchLevel(state, id);
    if (level >= def.maxLevel) return null;
    return Math.max(1, Math.round(def.baseCost * Math.pow(def.costGrowth, level)));
  }

  public static buyResearch(state: FactoryState, id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    const cost = FactoryEngine.researchCost(state, id);
    if (cost === null) return false;
    if (def.currency === 'stars') {
      if (state.stars < cost) return false;
      state.stars -= cost;
    } else {
      if (state.cash < cost) return false;
      state.cash -= cost;
    }
    state.research[id] = FactoryEngine.researchLevel(state, id) + 1;
    return true;
  }

  // --- Prestige ---------------------------------------------------------------

  /** Cash-this-run threshold to earn the player's next star. */
  public static prestigeThreshold(state: FactoryState): number {
    // Each star already earned makes the next one cost more run-cash.
    return PRESTIGE_BASE_THRESHOLD * Math.pow(3, Math.max(0, Math.floor(state.stars)));
  }

  /** Stars a prestige would grant right now (0 = locked). */
  public static pendingStars(state: FactoryState): number {
    const earned = state.stats.cashRun;
    const threshold = PRESTIGE_BASE_THRESHOLD;
    if (earned < threshold) return 0;
    // Square-root curve so each star needs ~quadratically more lifetime cash.
    return Math.max(1, Math.floor(Math.sqrt(earned / threshold)));
  }

  /**
   * Performs a prestige: banks pending stars, resets the line and run cash.
   * Stars, gems, star-research and stats survive. Returns stars granted (0 if
   * below threshold).
   */
  public static prestige(state: FactoryState): number {
    const stars = FactoryEngine.pendingStars(state);
    if (stars <= 0) return 0;
    state.stars += stars;
    state.stats.prestiges += 1;
    state.stats.cashRun = 0;
    state.cash = 0;
    state.menuLevel = 0;
    state.workersIdle = 0;
    state.workersHired = 0;
    for (const id of STATION_IDS) {
      state.stations[id] = { level: 1, workers: 0, output: 0 } as StationState;
    }
    // Cash-bought research resets; star-bought research is permanent.
    const keep: Record<string, number> = {};
    for (const def of RESEARCH_DEFS) {
      if (def.currency === 'stars') {
        const lvl = FactoryEngine.researchLevel(state, def.id);
        if (lvl > 0) keep[def.id] = lvl;
      }
    }
    state.research = keep;
    return stars;
  }

  // --- Offline accrual --------------------------------------------------------

  /** Offline window in seconds, capped (research raises the cap). */
  public static offlineCapSeconds(state: FactoryState): number {
    const extra = FactoryEngine.researchLevel(state, 'night_shift'); // +1h per level
    return (OFFLINE_CAP_HOURS + extra) * 3600;
  }

  /** Offline efficiency in [0,1] (research raises it toward full). */
  public static offlineEfficiency(state: FactoryState): number {
    return Math.min(1, OFFLINE_BASE_EFFICIENCY + FactoryEngine.researchBonus(state, 'offline'));
  }

  /**
   * Credits cash for time away using the line's steady-state revenue, capped
   * and scaled by offline efficiency. Returns the cash granted and the
   * (capped) seconds counted.
   */
  public static accrueOffline(state: FactoryState, seconds: number, now: number): { cash: number; seconds: number } {
    if (!(seconds > 0)) return { cash: 0, seconds: 0 };
    const capped = Math.min(seconds, FactoryEngine.offlineCapSeconds(state));
    // Use base (non-rush) revenue for offline.
    const rushless = state.rushEndsAt;
    state.rushEndsAt = 0;
    const rev = FactoryEngine.revenuePerSecond(state, now);
    state.rushEndsAt = rushless;
    const cash = rev * capped * FactoryEngine.offlineEfficiency(state);
    if (cash > 0) {
      state.cash += cash;
      state.stats.cashRun += cash;
      state.stats.cashAll += cash;
    }
    return { cash, seconds: capped };
  }
}

/** Re-export the station catalogue for the view layer's convenience. */
export { STATION_DEFS };
