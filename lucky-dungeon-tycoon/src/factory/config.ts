/**
 * config.ts — Tunable balance for the factory simulation.
 *
 * All numbers a designer would touch live here: station cadences, costs,
 * buffer sizes, worker boosts, the menu/price curve, research, and prestige.
 * Pure data; the engine reads it.
 */

import { StationId } from './types.js';

export interface StationDef {
  id: StationId;
  name: string;
  icon: string;
  /** One-line role, shown in the station panel. */
  blurb: string;
  /** Units/second processed at level 1, before any multipliers. */
  baseRate: number;
  /** Cadence multiplier per level: rate = baseRate * level. */
  /** Output buffer size at level 1 (grows with level). */
  baseBuffer: number;
  /** Cost of the first build/upgrade. */
  upgradeBaseCost: number;
  /** Geometric cost growth per level already owned. */
  upgradeGrowth: number;
}

/**
 * The five stations of the line, in flow order. Cadences are tuned so the
 * line is roughly balanced at equal levels, making deliberate over-investment
 * (and the resulting bottleneck) a player choice rather than a forced one.
 */
export const STATION_DEFS: readonly StationDef[] = [
  {
    id: 'receiving', name: 'Réception', icon: '🚚',
    blurb: 'Décharge les ingrédients bruts dans la ligne.',
    baseRate: 1.0, baseBuffer: 24, upgradeBaseCost: 40, upgradeGrowth: 1.17,
  },
  {
    id: 'prep', name: 'Préparation', icon: '🔪',
    blurb: 'Lave, épluche et découpe les ingrédients.',
    baseRate: 0.95, baseBuffer: 22, upgradeBaseCost: 55, upgradeGrowth: 1.18,
  },
  {
    id: 'cooking', name: 'Cuisson', icon: '🍳',
    blurb: 'Cuit les préparations en plats chauds.',
    baseRate: 0.9, baseBuffer: 20, upgradeBaseCost: 80, upgradeGrowth: 1.19,
  },
  {
    id: 'plating', name: 'Dressage', icon: '🍱',
    blurb: 'Dresse et emballe les plats prêts à partir.',
    baseRate: 0.95, baseBuffer: 22, upgradeBaseCost: 70, upgradeGrowth: 1.185,
  },
  {
    id: 'delivery', name: 'Expédition', icon: '🛵',
    blurb: 'Livre les plats aux clients et encaisse.',
    baseRate: 1.0, baseBuffer: 26, upgradeBaseCost: 60, upgradeGrowth: 1.18,
  },
];

export const STATION_DEF_BY_ID: Readonly<Record<StationId, StationDef>> =
  Object.freeze(
    STATION_DEFS.reduce((acc, d) => {
      acc[d.id] = d;
      return acc;
    }, {} as Record<StationId, StationDef>),
  );

/** Each worker assigned to a station adds this fraction to its cadence. */
export const WORKER_BOOST = 0.35;
/** Base cost of the first worker; grows geometrically with total hired. */
export const WORKER_BASE_COST = 250;
export const WORKER_COST_GROWTH = 1.55;
/** Hard cap on workers per station, to keep the boost from running away. */
export const WORKERS_PER_STATION_CAP = 8;

/** € earned per dish sold at menu level 0. */
export const BASE_DISH_PRICE = 8;
/** Each menu tier multiplies the dish price. */
export const MENU_PRICE_GROWTH = 1.6;
/** Cost of the first menu upgrade; grows per tier. */
export const MENU_BASE_COST = 500;
export const MENU_COST_GROWTH = 2.15;

/** A research definition: a permanent, line-wide multiplier track. */
export interface ResearchDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Additive bonus per level (0.05 = +5% per level). */
  perLevel: number;
  /** What the bonus feeds. */
  effect: 'rate' | 'price' | 'offline' | 'buffer';
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Currency: 'cash' for most, 'stars' for prestige-only research. */
  currency: 'cash' | 'stars';
}

export const RESEARCH_DEFS: readonly ResearchDef[] = [
  {
    id: 'sharp_knives', name: 'Couteaux affûtés', icon: '⚡',
    description: 'Cadence de toutes les stations',
    perLevel: 0.08, effect: 'rate', baseCost: 1_500, costGrowth: 1.9, maxLevel: 20, currency: 'cash',
  },
  {
    id: 'big_fridges', name: 'Chambres froides', icon: '🧊',
    description: 'Capacité des tampons',
    perLevel: 0.25, effect: 'buffer', baseCost: 1_200, costGrowth: 1.8, maxLevel: 12, currency: 'cash',
  },
  {
    id: 'plating_art', name: 'Art du dressage', icon: '💶',
    description: 'Prix de vente des plats',
    perLevel: 0.06, effect: 'price', baseCost: 3_000, costGrowth: 2.0, maxLevel: 20, currency: 'cash',
  },
  {
    id: 'night_shift', name: 'Équipe de nuit', icon: '🌙',
    description: 'Gains hors-ligne',
    perLevel: 0.05, effect: 'offline', baseCost: 2, costGrowth: 1.7, maxLevel: 15, currency: 'stars',
  },
  {
    id: 'master_recipe', name: 'Recette signature', icon: '⭐',
    description: 'Cadence ET prix (permanent)',
    perLevel: 0.04, effect: 'rate', baseCost: 3, costGrowth: 1.8, maxLevel: 25, currency: 'stars',
  },
];

export const RESEARCH_BY_ID: Readonly<Record<string, ResearchDef>> = Object.freeze(
  RESEARCH_DEFS.reduce((acc, d) => {
    acc[d.id] = d;
    return acc;
  }, {} as Record<string, ResearchDef>),
);

/** Cash earned this run required before the first prestige star is offered. */
export const PRESTIGE_BASE_THRESHOLD = 1_000_000;
/** Each prestige star adds this fraction to the global multiplier. */
export const STAR_BONUS = 0.12;
/** A production rush (ad/boost) multiplies output for its duration. */
export const RUSH_MULTIPLIER = 3;
export const RUSH_SECONDS = 60;
/** Offline accrual is capped at this many hours (before night-shift research). */
export const OFFLINE_CAP_HOURS = 8;
/** Baseline offline efficiency (research raises it toward 1). */
export const OFFLINE_BASE_EFFICIENCY = 0.5;
