import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  EMPTY_USAGE,
  LLMError,
  type BatchItem,
  type BatchStatus,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
  type LLMUsage,
  type SystemBlock,
} from "./types";

/**
 * Anthropic implementation of LLMProvider (official SDK, model claude-opus-5-5).
 *
 * - Adaptive thinking is always on for this model; depth is set with
 *   output_config.effort (high = DNA, medium = full generation, low = retouches).
 * - No `temperature` (rejected by the model): diversity comes from the A/B/C
 *   angles imposed in the prompt.
 * - Structured outputs through output_config.format (JSON schema from zod),
 *   validated again on our side.
 * - Prompt caching: fixed rules first, then the artist DNA with cache_control.
 * - Streaming for every call (long outputs, live display).
 * - Refusals: stop_reason "refusal" is handled before reading content, and the
 *   server-side fallback (`fallbacks: "default"`) re-runs a declined request on
 *   Anthropic's recommended fallback model inside the same call.
 * - Batch API for large catalogues (fallbacks are not accepted there).
 */

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type FormatOf = { type: "json_schema"; schema: Record<string, unknown> };

/** JSON schema sent to the API (constraints it does not support are moved to descriptions). */
export function outputFormat<T>(schema: z.ZodType<T>): FormatOf {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse, ...format } = betaZodOutputFormat(schema as z.ZodType<T>);
  return format as FormatOf;
}

function systemParam(blocks: SystemBlock[]) {
  return blocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" as const, ttl: b.cache } } : {}),
  }));
}

type AnyUsage = {
  input_tokens: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number } | null;
  iterations?: Array<AnyUsage & { type?: string }> | null;
};

/** Sums usage over every attempt (a declined attempt + its fallback are both billed). */
export function usageFrom(u: AnyUsage | null | undefined): LLMUsage {
  if (!u) return { ...EMPTY_USAGE };
  const parts = u.iterations?.length ? u.iterations : [u];
  return parts.reduce<LLMUsage>(
    (acc, p) => ({
      inputTokens: acc.inputTokens + (p.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (p.output_tokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (p.cache_read_input_tokens ?? 0),
      cacheWriteTokens: acc.cacheWriteTokens + (p.cache_creation_input_tokens ?? 0),
      cacheWrite1hTokens: acc.cacheWrite1hTokens + (p.cache_creation?.ephemeral_1h_input_tokens ?? 0),
    }),
    { ...EMPTY_USAGE },
  );
}

type ContentBlock = { type: string; text?: string };

/** Extracts the JSON text: all text blocks (a mid-stream fallback continues the partial). */
export function extractText(content: ContentBlock[]): { all: string; afterFallback: string } {
  let all = "";
  let afterFallback = "";
  for (const b of content) {
    if (b.type === "fallback") afterFallback = "";
    if (b.type === "text" && b.text) {
      all += b.text;
      afterFallback += b.text;
    }
  }
  return { all, afterFallback };
}

export function parseStructured<T>(schema: z.ZodType<T>, texts: string[]): { data: T | null; error?: string } {
  let lastError = "empty output";
  for (const t of texts) {
    if (!t.trim()) continue;
    try {
      const json = JSON.parse(t);
      const parsed = schema.safeParse(json);
      if (parsed.success) return { data: parsed.data };
      lastError = parsed.error.message.slice(0, 500);
    } catch (e) {
      lastError = `invalid JSON: ${(e as Error).message}`;
    }
  }
  return { data: null, error: lastError };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async stream<T>(req: LLMRequest<T>, onText?: (delta: string) => void): Promise<LLMResult<T>> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: req.effort, format: outputFormat(req.schema) },
          system: systemParam(req.system),
          messages: req.messages,
        },
        { signal: req.signal },
      );
      if (onText) stream.on("text", (delta) => onText(delta));
      const msg = await stream.finalMessage();
      return this.toResult(req.schema, msg as unknown as RawMessage);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || req.signal?.aborted) {
        throw new LLMError("Request aborted", "aborted");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new LLMError("Rate limited by the AI provider, retry shortly", "provider_error");
      }
      if (err instanceof Anthropic.APIError) {
        throw new LLMError(`AI provider error ${err.status ?? ""}: ${err.message}`.trim(), "provider_error");
      }
      throw err;
    }
  }

  private toResult<T>(schema: z.ZodType<T>, msg: RawMessage): LLMResult<T> {
    const usage = usageFrom(msg.usage);
    const fallbackUsed =
      msg.content.some((b) => b.type === "fallback") ||
      (msg.usage?.iterations ?? []).some((i) => i.type === "fallback_message");
    const base = {
      rawText: "",
      stopReason: msg.stop_reason ?? null,
      usage,
      model: msg.model ?? this.model,
      fallbackUsed,
    };
    // Always check stop_reason before reading content.
    if (msg.stop_reason === "refusal") {
      return {
        ...base,
        data: null,
        refusal: {
          category: msg.stop_details?.category ?? null,
          explanation: msg.stop_details?.explanation ?? null,
        },
      };
    }
    const { all, afterFallback } = extractText(msg.content);
    if (msg.stop_reason === "max_tokens") {
      return { ...base, rawText: all, data: null, refusal: null, error: "truncated (max_tokens)" };
    }
    const parsed = parseStructured(schema, fallbackUsed ? [all, afterFallback] : [all]);
    return { ...base, rawText: all, data: parsed.data, refusal: null, error: parsed.error };
  }

  async submitBatch<T>(items: BatchItem<T>[]): Promise<string> {
    const batch = await this.client.messages.batches.create({
      requests: items.map((it) => ({
        custom_id: it.customId,
        params: {
          model: this.model,
          max_tokens: it.request.maxTokens,
          thinking: { type: "adaptive" as const },
          output_config: { effort: it.request.effort, format: outputFormat(it.request.schema) },
          system: systemParam(it.request.system),
          messages: it.request.messages,
        },
      })),
    });
    return batch.id;
  }

  async batchStatus(batchId: string): Promise<BatchStatus> {
    const b = await this.client.messages.batches.retrieve(batchId);
    return b.processing_status as BatchStatus;
  }

  async batchResults<T>(batchId: string, schema: z.ZodType<T>): Promise<Map<string, LLMResult<T>>> {
    const out = new Map<string, LLMResult<T>>();
    for await (const r of await this.client.messages.batches.results(batchId)) {
      if (r.result.type === "succeeded") {
        out.set(r.custom_id, this.toResult(schema, r.result.message as unknown as RawMessage));
      } else {
        out.set(r.custom_id, {
          data: null,
          rawText: "",
          stopReason: null,
          refusal: null,
          usage: { ...EMPTY_USAGE },
          model: this.model,
          fallbackUsed: false,
          error: `batch item ${r.result.type}`,
        });
      }
    }
    return out;
  }
}

interface RawMessage {
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: ContentBlock[];
  usage?: AnyUsage | null;
}
