/**
 * Cost of a call from the logged token usage. Prices are configurable through
 * environment variables (LLM_PRICE_*) because they change; defaults are the
 * indicative Claude Opus 5.5 rates ($ per million tokens).
 *
 * Cache economics: reads ≈ 0.05x input on Opus 5.5 ($0.20/MTok), writes 1.25x
 * (5-minute TTL) or 2x (1-hour TTL).
 */
import type { LLMUsage } from "./types";

export interface Prices {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const DEFAULT_PRICES: Prices = { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 };

/** Batch API: 50 % off every token. */
export const BATCH_DISCOUNT = 0.5;

export function costUSD(usage: LLMUsage, prices: Prices = DEFAULT_PRICES, batch = false): number {
  const m = 1_000_000;
  const write5m = usage.cacheWriteTokens - usage.cacheWrite1hTokens;
  const cost =
    (usage.inputTokens * prices.inputPerMTok) / m +
    (usage.outputTokens * prices.outputPerMTok) / m +
    (usage.cacheReadTokens * prices.cacheReadPerMTok) / m +
    (write5m * prices.inputPerMTok * 1.25) / m +
    (usage.cacheWrite1hTokens * prices.inputPerMTok * 2) / m;
  return Math.round(cost * (batch ? BATCH_DISCOUNT : 1) * 1e6) / 1e6;
}

export function pricesFromEnv(env: {
  LLM_PRICE_INPUT_PER_MTOK: number;
  LLM_PRICE_OUTPUT_PER_MTOK: number;
  LLM_PRICE_CACHE_READ_PER_MTOK: number;
}): Prices {
  return {
    inputPerMTok: env.LLM_PRICE_INPUT_PER_MTOK,
    outputPerMTok: env.LLM_PRICE_OUTPUT_PER_MTOK,
    cacheReadPerMTok: env.LLM_PRICE_CACHE_READ_PER_MTOK,
  };
}

/**
 * Gross margin of a plan for a given AI cost per user (all amounts in EUR,
 * VAT excluded). Payment fees: Stripe EU cards ≈ 1.5 % + 0.25 €.
 */
export function grossMargin(opts: {
  priceTTC: number;
  vatRate?: number;
  aiCostEUR: number;
  infraCostEUR?: number;
}): { revenueHT: number; fees: number; cogs: number; margin: number } {
  const revenueHT = opts.priceTTC / (1 + (opts.vatRate ?? 0.2));
  const fees = opts.priceTTC * 0.015 + 0.25;
  const cogs = opts.aiCostEUR + (opts.infraCostEUR ?? 0) + fees;
  return { revenueHT, fees, cogs, margin: revenueHT > 0 ? (revenueHT - cogs) / revenueHT : 0 };
}

/**
 * Largest monthly quota of full generations that keeps the target gross
 * margin, assuming users consume `utilization` of their quota on average.
 */
export function maxGenerationsForMargin(opts: {
  priceTTC: number;
  costPerGenerationEUR: number;
  otherAiCostEUR: number;
  infraCostEUR: number;
  targetMargin?: number;
  utilization?: number;
}): number {
  const target = opts.targetMargin ?? 0.7;
  const util = opts.utilization ?? 0.35;
  const { revenueHT, fees } = grossMargin({ priceTTC: opts.priceTTC, aiCostEUR: 0 });
  const budget = revenueHT * (1 - target) - fees - opts.infraCostEUR - opts.otherAiCostEUR;
  if (budget <= 0 || opts.costPerGenerationEUR <= 0) return 0;
  return Math.floor(budget / (opts.costPerGenerationEUR * util));
}
