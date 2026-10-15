/**
 * Provider-agnostic LLM interface. The app only talks to `LLMProvider`; the
 * Anthropic implementation lives in ./anthropic.ts and a deterministic mock in
 * ./mock.ts (local dev without an API key, end-to-end tests).
 */
import type { z } from "zod";

export type Effort = "low" | "medium" | "high";

export type LLMTask = "dna" | "dna_track" | "lyrics" | "retouch" | "assist";

export interface SystemBlock {
  text: string;
  /** Prompt-cache breakpoint placed at the END of this block. */
  cache?: "5m" | "1h";
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest<T> {
  task: LLMTask;
  system: SystemBlock[];
  messages: LLMMessage[];
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Part of cacheWriteTokens written with the 1-hour TTL (billed 2x). */
  cacheWrite1hTokens: number;
}

export interface LLMRefusal {
  category: string | null;
  explanation: string | null;
}

export interface LLMResult<T> {
  /** Parsed and validated output, null on refusal / truncation / invalid JSON. */
  data: T | null;
  rawText: string;
  stopReason: string | null;
  refusal: LLMRefusal | null;
  usage: LLMUsage;
  /** Model that actually served the response (may be a server-side fallback). */
  model: string;
  fallbackUsed: boolean;
  error?: string;
}

export interface BatchItem<T> {
  customId: string;
  request: LLMRequest<T>;
}

export type BatchStatus = "in_progress" | "canceling" | "ended";

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** Streams the structured JSON text as it is generated. */
  stream<T>(req: LLMRequest<T>, onText?: (delta: string) => void): Promise<LLMResult<T>>;
  /** Message Batches (-50 %), for large catalogue analyses. */
  submitBatch<T>(items: BatchItem<T>[]): Promise<string>;
  batchStatus(batchId: string): Promise<BatchStatus>;
  batchResults<T>(batchId: string, schema: z.ZodType<T>): Promise<Map<string, LLMResult<T>>>;
}

export const EMPTY_USAGE: LLMUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
};

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: "refusal" | "truncated" | "invalid_output" | "provider_error" | "aborted",
    public readonly result?: LLMResult<unknown>,
  ) {
    super(message);
  }
}
