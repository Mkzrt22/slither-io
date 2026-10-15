import "server-only";
import { env, llmIsMock } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { costUSD, pricesFromEnv } from "./pricing";
import type { LLMProvider, LLMUsage } from "./types";

let provider: LLMProvider | null = null;

/** The configured LLM provider (Anthropic, or the offline mock without API key). */
export function getLLM(): LLMProvider {
  if (provider) return provider;
  const e = env();
  provider = llmIsMock() ? new MockProvider() : new AnthropicProvider(e.ANTHROPIC_API_KEY!, e.ANTHROPIC_MODEL);
  return provider;
}

/** Cost in USD of a call with the configured prices. */
export function callCost(usage: LLMUsage, batch = false): number {
  return costUSD(usage, pricesFromEnv(env()), batch);
}

/** Output token budgets per task (streaming allows large values). */
export const MAX_TOKENS = {
  dna: 32000,
  dna_track: 4000,
  lyrics: 32000,
  retouch: 6000,
  assist: 3000,
} as const;

/** Effort per task, pinned per route so the prompt cache stays valid. */
export const EFFORT = {
  dna: "high",
  dna_track: "low",
  lyrics: "medium",
  retouch: "low",
  assist: "low",
} as const;
