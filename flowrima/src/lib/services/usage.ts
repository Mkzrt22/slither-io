import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuotaResult, UsageFeature } from "@/lib/db/types";
import type { LLMResult } from "@/lib/ai/types";
import { callCost } from "@/lib/ai";

/**
 * Server-side quota check + consumption in ONE atomic SQL call
 * (public.consume_quota locks the user's row). Never trust the client.
 */
export async function consumeQuota(
  userId: string,
  feature: UsageFeature,
  reference?: string,
  metadata: Record<string, unknown> = {},
): Promise<QuotaResult> {
  const { data, error } = await createAdminClient().rpc("consume_quota", {
    p_user: userId,
    p_feature: feature,
    p_quantity: 1,
    p_reference: reference ?? null,
    p_metadata: metadata,
  } as never);
  if (error) throw new Error(`consume_quota failed: ${error.message}`);
  return data as unknown as QuotaResult;
}

export async function refundUsage(eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  await createAdminClient().rpc("refund_usage", { p_event_id: eventId } as never);
}

export async function createGeneration(row: {
  owner_id: string;
  artist_id?: string | null;
  project_id?: string | null;
  type: "lyrics" | "retouch" | "assist" | "dna";
  params_json: Record<string, unknown>;
  effort: string;
  model: string;
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("generations")
    .insert({ ...row, status: "streaming" } as never)
    .select("id")
    .single();
  if (error) throw new Error(`generation insert failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** Logs tokens and real cost of a call (spec: journaliser `usage` à chaque appel). */
export async function finishGeneration(
  id: string,
  result: Pick<LLMResult<unknown>, "usage" | "model" | "stopReason"> | null,
  patch: {
    status: "done" | "error" | "refused" | "blocked";
    output_json?: unknown;
    error?: string | null;
    startedAt: number;
    batch?: boolean;
  },
): Promise<void> {
  const usage = result?.usage;
  await createAdminClient()
    .from("generations")
    .update({
      status: patch.status,
      output_json: patch.output_json ?? null,
      error: patch.error ?? null,
      model: result?.model,
      stop_reason: result?.stopReason ?? null,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      cache_read_tokens: usage?.cacheReadTokens ?? 0,
      cache_write_tokens: usage?.cacheWriteTokens ?? 0,
      cost: usage ? callCost(usage, patch.batch) : 0,
      duration_ms: Date.now() - patch.startedAt,
    } as never)
    .eq("id", id);
}

export async function flagModeration(row: {
  user_id: string;
  generation_id?: string | null;
  lyric_version_id?: string | null;
  source: "model" | "refusal" | "automatic";
  category?: string | null;
  reason?: string | null;
  excerpt?: string | null;
}): Promise<void> {
  await createAdminClient().from("moderation_flags").insert(row as never);
}
