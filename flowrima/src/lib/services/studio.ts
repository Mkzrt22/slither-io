import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { EFFORT, MAX_TOKENS, getLLM } from "@/lib/ai";
import {
  assistSystem, buildAssistRequest, buildLyricsRequest, buildRetouchRequest, lyricsSystem, retouchSystem,
  type ArtistContext, type LyricsRequestInput, type RetouchAction,
} from "@/lib/ai/prompts/lyrics";
import {
  AssistOutputSchema, LyricsOutputSchema, RetouchOutputSchema,
  type AssistOutput, type LyricsOutput, type Proposal,
} from "@/lib/ai/schemas";
import { LLMError, type LLMProvider, type LLMResult } from "@/lib/ai/types";
import { buildCatalogIndex, checkRecycling, type CatalogIndex, type RecyclingViolation } from "@/lib/text/recycling";
import { parseLyrics, sectionsToText } from "@/lib/text/parse";
import { findRhymes, type RhymeSuggestion } from "@/lib/text/rhyme-dictionary";
import { schemeLabel } from "@/lib/text/rhymes";
import type { ArtistDnaRow, LyricContent, LyricSection, LyricVersionRow, TrackRow } from "@/lib/db/types";
import { consumeQuota, createGeneration, finishGeneration, flagModeration, refundUsage } from "./usage";

/** Placeholder written when a line cannot be made original automatically. */
export const REMOVED_LINE = "[ligne retirée : trop proche d'une de tes paroles — à réécrire]";

export class StudioError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "no_dna" | "quota_exceeded" | "refused" | "blocked" | "invalid_output" | "provider_error" | "not_found",
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface LoadedContext {
  ctx: ArtistContext;
  dna: ArtistDnaRow;
  index: CatalogIndex;
  catalogLines: string[];
  vocabulary: string[];
}

/** Latest ready DNA + catalogue index (for anti-recycling) of an artist. */
export async function loadArtistContext(userId: string, artistId: string): Promise<LoadedContext> {
  const db = createAdminClient();
  const [{ data: artist }, { data: dnaRow }, { data: trackRows }] = await Promise.all([
    db.from("artist_profiles").select("id, owner_id, stage_name").eq("id", artistId).single(),
    db.from("artist_dna").select("*").eq("artist_id", artistId).eq("status", "ready")
      .order("version", { ascending: false }).limit(1).maybeSingle(),
    db.from("tracks").select("title, lyrics").eq("artist_id", artistId).eq("owner_id", userId),
  ]);
  if (!artist || (artist as { owner_id: string }).owner_id !== userId) throw new StudioError("Artiste introuvable", "not_found");
  const dna = dnaRow as ArtistDnaRow | null;
  if (!dna?.dna_json) throw new StudioError("Analyse ton ADN avant d'écrire", "no_dna");

  const tracks = ((trackRows as Pick<TrackRow, "title" | "lyrics">[] | null) ?? []).filter((t) => t.lyrics);
  const parsed = tracks.map((t) => ({ title: t.title, lines: parseLyrics(t.lyrics!).flatMap((s) => s.lines) }));
  const m = dna.dna_json.metrics;
  const ctx: ArtistContext = {
    stageName: (artist as { stage_name: string }).stage_name,
    dnaVersion: dna.version,
    dna: dna.dna_json.llm,
    measures: {
      syllablesPerBar: m.syllablesPerBar.avg,
      dominantPatterns: m.rhymes.dominantPatterns.map((p) => schemeLabel(p.pattern)),
      typicalStructure: m.structure.typicalSequence,
      signatureWords: m.vocabulary.signatureWords.map((w) => w.word),
      adlibs: m.adlibs.map(([a]) => a),
    },
    excerpts: dna.dna_json.excerpts,
  };
  return {
    ctx,
    dna,
    index: buildCatalogIndex(parsed),
    catalogLines: parsed.flatMap((p) => p.lines),
    vocabulary: m.vocabulary.topWords.map(([w]) => w),
  };
}

function toContent(p: Proposal): LyricContent {
  return {
    angle: p.angle,
    sections: p.sections.map((s) => ({
      type: s.type,
      label: s.label,
      bars: s.lines.length,
      flow: s.flow,
      lines: s.lines.map((l) => l.trim()).filter(Boolean),
    })),
  };
}

export function contentToText(c: LyricContent): string {
  return sectionsToText(c.sections);
}

/**
 * Anti-recycling post-processing: every line sharing more than 4 consecutive
 * words with the catalogue is rewritten (one low-effort retouch call per
 * version); lines still failing are replaced by a placeholder, so a saved
 * version can never violate the rule.
 */
export async function enforceOriginality(
  content: LyricContent,
  loaded: Pick<LoadedContext, "ctx" | "index">,
  opts: { allowed?: string[]; explicit: boolean; llm?: LLMProvider },
): Promise<{ content: LyricContent; report: { fixed: number; removed: number; nearDuplicates: RecyclingViolation[] }; extra: LLMResult<unknown>[] }> {
  const flat = content.sections.flatMap((s, si) => s.lines.map((line, li) => ({ si, li, line })));
  const violations = checkRecycling(flat.map((f) => f.line), loaded.index, { allowed: opts.allowed });
  const hard = violations.filter((v) => v.type === "ngram");
  const near = violations.filter((v) => v.type === "near_duplicate");
  const extra: LLMResult<unknown>[] = [];
  let fixed = 0;
  let removed = 0;
  if (hard.length === 0) return { content, report: { fixed, removed, nearDuplicates: near }, extra };

  const next: LyricContent = structuredClone(content);
  const targets = hard.map((v) => flat[v.lineIndex]);
  try {
    const res = await (opts.llm ?? getLLM()).stream({
      task: "retouch",
      system: retouchSystem(loaded.ctx),
      messages: [{
        role: "user",
        content: buildRetouchRequest({
          action: "avoid_recycling",
          song: next.sections,
          targetLabel: "Lignes à corriger",
          targetLines: targets.map((t) => t.line),
          syllableTarget: { target: loaded.ctx.measures.syllablesPerBar || 12, min: 4, max: 24 },
          explicit: opts.explicit,
          forbiddenLines: hard.map((v) => v.source.line),
        }),
      }],
      schema: RetouchOutputSchema,
      effort: EFFORT.retouch,
      maxTokens: MAX_TOKENS.retouch,
    });
    extra.push(res as LLMResult<unknown>);
    const newLines = res.data?.safety.status === "ok" ? res.data.lines : [];
    targets.forEach((t, k) => {
      const candidate = newLines[k];
      const ok = candidate && checkRecycling([candidate], loaded.index, { allowed: opts.allowed }).every((v) => v.type !== "ngram");
      if (ok) {
        next.sections[t.si].lines[t.li] = candidate;
        fixed++;
      } else {
        next.sections[t.si].lines[t.li] = REMOVED_LINE;
        removed++;
      }
    });
  } catch {
    targets.forEach((t) => {
      next.sections[t.si].lines[t.li] = REMOVED_LINE;
      removed++;
    });
  }
  return { content: next, report: { fixed, removed, nearDuplicates: near }, extra };
}

export interface GenerateParams extends Omit<LyricsRequestInput, "syllableTarget"> {
  syllableTarget: { target: number; min: number; max: number };
}

export interface GenerateResult {
  generationId: string;
  versions: Array<Pick<LyricVersionRow, "id" | "variant" | "title" | "content_json" | "why_json" | "recycling_report">>;
  quota: { used: number; limit: number };
}

/**
 * Full generation (3 proposals A/B/C), streamed. `onDelta` receives the raw
 * JSON text as it is written (the client renders it progressively).
 */
export async function generateLyrics(opts: {
  userId: string;
  artistId: string;
  projectId: string;
  params: GenerateParams;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<GenerateResult> {
  const startedAt = Date.now();
  const loaded = await loadArtistContext(opts.userId, opts.artistId);

  const quota = await consumeQuota(opts.userId, "lyrics_generation", opts.projectId);
  if (!quota.allowed) {
    throw new StudioError("Quota de générations atteint", "quota_exceeded", { used: quota.used, limit: quota.limit });
  }

  const llm = getLLM();
  const generationId = await createGeneration({
    owner_id: opts.userId,
    artist_id: opts.artistId,
    project_id: opts.projectId,
    type: "lyrics",
    params_json: { ...opts.params, dnaVersion: loaded.dna.version },
    effort: EFFORT.lyrics,
    model: llm.model,
  });

  let result: LLMResult<LyricsOutput>;
  try {
    result = await llm.stream(
      {
        task: "lyrics",
        system: lyricsSystem(loaded.ctx),
        messages: [{ role: "user", content: buildLyricsRequest(opts.params) }],
        schema: LyricsOutputSchema,
        effort: EFFORT.lyrics,
        maxTokens: MAX_TOKENS.lyrics,
        signal: opts.signal,
      },
      opts.onDelta,
    );
  } catch (e) {
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, null, { status: "error", error: (e as Error).message, startedAt });
    if (e instanceof LLMError) throw new StudioError(e.message, e.code === "aborted" ? "provider_error" : "provider_error");
    throw e;
  }

  if (result.refusal) {
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, result, { status: "refused", startedAt });
    await flagModeration({
      user_id: opts.userId, generation_id: generationId, source: "refusal",
      category: result.refusal.category, reason: result.refusal.explanation,
      excerpt: opts.params.subject?.slice(0, 500) ?? null,
    });
    throw new StudioError("La demande a été refusée par le modèle.", "refused", { category: result.refusal.category });
  }
  if (!result.data) {
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, result, { status: "error", error: result.error ?? "invalid_output", startedAt });
    throw new StudioError("La génération a échoué, réessaie (non décomptée).", "invalid_output");
  }
  if (result.data.safety.status === "declined") {
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, result, { status: "blocked", output_json: result.data, startedAt });
    await flagModeration({
      user_id: opts.userId, generation_id: generationId, source: "model", category: "policy",
      reason: result.data.safety.reason, excerpt: opts.params.subject?.slice(0, 500) ?? null,
    });
    throw new StudioError(result.data.safety.reason || "Demande non conforme à nos règles.", "blocked");
  }

  // ---- post-processing: originality + persistence -------------------------
  const proposals = result.data.proposals.slice(0, 3);
  const extra: LLMResult<unknown>[] = [];
  const db = createAdminClient();
  const versions: GenerateResult["versions"] = [];
  for (const p of proposals) {
    const { content, report, extra: ex } = await enforceOriginality(toContent(p), loaded, {
      allowed: opts.params.allowedGimmick ? [opts.params.allowedGimmick] : [],
      explicit: opts.params.explicit,
    });
    extra.push(...ex);
    const { data: v, error } = await db
      .from("lyric_versions")
      .insert({
        owner_id: opts.userId,
        project_id: opts.projectId,
        generation_id: generationId,
        variant: p.variant,
        label: { A: "A — fidèle", B: "B — évolution", C: "C — audace" }[p.variant],
        title: p.title,
        content_json: content,
        content_text: contentToText(content),
        why_json: p.why_it_sounds_like_you.slice(0, 3),
        is_ai_generated: true,
        recycling_report: report,
      } as never)
      .select("id, variant, title, content_json, why_json, recycling_report")
      .single();
    if (error) throw new Error(`version insert failed: ${error.message}`);
    versions.push(v as GenerateResult["versions"][number]);
  }

  await db.from("projects").update({ status: "writing" } as never).eq("id", opts.projectId).eq("status", "idea");

  // Cost = main call + originality fixes
  const usage = [result as LLMResult<unknown>, ...extra].reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.usage.cacheWriteTokens,
      cacheWrite1hTokens: acc.cacheWrite1hTokens + r.usage.cacheWrite1hTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 },
  );
  await finishGeneration(generationId, { ...result, usage }, {
    status: "done",
    output_json: { proposals: result.data.proposals, fallback: result.fallbackUsed },
    startedAt,
  });

  return { generationId, versions, quota: { used: quota.used, limit: quota.limit } };
}

// -----------------------------------------------------------------------------
// Retouches (line / section / chorus) — effort low
// -----------------------------------------------------------------------------
export async function retouchLines(opts: {
  userId: string;
  artistId: string;
  projectId: string;
  action: RetouchAction;
  song: LyricSection[];
  sectionIndex: number;
  lineIndexes: number[];
  syllableTarget: { target: number; min: number; max: number };
  keepRhyme?: string | null;
  explicit: boolean;
}): Promise<{ lines: string[]; note: string; quota: { used: number; limit: number } }> {
  const startedAt = Date.now();
  const loaded = await loadArtistContext(opts.userId, opts.artistId);
  const section = opts.song[opts.sectionIndex];
  if (!section) throw new StudioError("Partie introuvable", "not_found");
  const targetLines = opts.lineIndexes.map((i) => section.lines[i]).filter((l) => l !== undefined);
  if (!targetLines.length) throw new StudioError("Aucune ligne à retoucher", "not_found");

  const quota = await consumeQuota(opts.userId, "retouch", opts.projectId, { action: opts.action });
  if (!quota.allowed) throw new StudioError("Quota de retouches atteint", "quota_exceeded", { used: quota.used, limit: quota.limit });

  const llm = getLLM();
  const generationId = await createGeneration({
    owner_id: opts.userId, artist_id: opts.artistId, project_id: opts.projectId, type: "retouch",
    params_json: { action: opts.action, section: section.label, lines: opts.lineIndexes.length },
    effort: EFFORT.retouch, model: llm.model,
  });

  const run = (action: RetouchAction, forbidden: string[] = []) =>
    llm.stream({
      task: "retouch",
      system: retouchSystem(loaded.ctx),
      messages: [{
        role: "user",
        content: buildRetouchRequest({
          action, song: opts.song, targetLabel: section.label, targetLines,
          keepRhyme: opts.keepRhyme, syllableTarget: opts.syllableTarget, explicit: opts.explicit,
          forbiddenLines: forbidden,
        }),
      }],
      schema: RetouchOutputSchema,
      effort: EFFORT.retouch,
      maxTokens: MAX_TOKENS.retouch,
    });

  let result: LLMResult<{ safety: { status: string; reason: string }; lines: string[]; note: string }>;
  try {
    result = await run(opts.action);
  } catch (e) {
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, null, { status: "error", error: (e as Error).message, startedAt });
    throw new StudioError("Retouche impossible pour le moment, réessaie.", "provider_error");
  }
  if (result.refusal || !result.data || result.data.safety.status !== "ok") {
    await refundUsage(quota.event_id);
    const status = result.refusal ? "refused" : result.data ? "blocked" : "error";
    await finishGeneration(generationId, result, { status, startedAt, error: result.error });
    if (status !== "error") {
      await flagModeration({
        user_id: opts.userId, generation_id: generationId, source: result.refusal ? "refusal" : "model",
        category: result.refusal?.category ?? "policy", reason: result.data?.safety.reason ?? null,
      });
    }
    throw new StudioError(result.data?.safety.reason || "Retouche refusée ou invalide.", status === "error" ? "invalid_output" : "blocked");
  }

  let lines = result.data.lines.slice(0, targetLines.length);
  const extra: LLMResult<unknown>[] = [];
  // Anti-recycling on the new lines (one retry, then placeholder)
  let bad = checkRecycling(lines, loaded.index).filter((v) => v.type === "ngram");
  if (bad.length) {
    const retry = await run("avoid_recycling", bad.map((b) => b.source.line));
    extra.push(retry as LLMResult<unknown>);
    if (retry.data?.lines?.length) lines = retry.data.lines.slice(0, targetLines.length);
    bad = checkRecycling(lines, loaded.index).filter((v) => v.type === "ngram");
    for (const b of bad) lines[b.lineIndex] = REMOVED_LINE;
  }

  const usage = [result as LLMResult<unknown>, ...extra].reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.usage.cacheWriteTokens,
      cacheWrite1hTokens: acc.cacheWrite1hTokens + r.usage.cacheWrite1hTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 },
  );
  await finishGeneration(generationId, { ...result, usage }, { status: "done", output_json: { lines }, startedAt });
  return { lines, note: result.data.note, quota: { used: quota.used, limit: quota.limit } };
}

// -----------------------------------------------------------------------------
// Dictionnaire de rimes : local (gratuit) + suggestions IA contextuelles
// -----------------------------------------------------------------------------
export async function localRhymes(userId: string, artistId: string | null, word: string): Promise<RhymeSuggestion[]> {
  let vocabulary: string[] = [];
  if (artistId) {
    const { data } = await createAdminClient()
      .from("artist_dna").select("dna_json").eq("artist_id", artistId).eq("owner_id", userId).eq("status", "ready")
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const dna = (data as Pick<ArtistDnaRow, "dna_json"> | null)?.dna_json;
    vocabulary = dna ? dna.metrics.vocabulary.topWords.map(([w]) => w) : [];
  }
  return findRhymes(word, vocabulary, 40);
}

export async function aiAssist(opts: {
  userId: string;
  artistId: string;
  projectId: string | null;
  word: string;
  line: string;
  explicit: boolean;
}): Promise<{ result: AssistOutput; quota: { used: number; limit: number } }> {
  const startedAt = Date.now();
  const loaded = await loadArtistContext(opts.userId, opts.artistId);
  const quota = await consumeQuota(opts.userId, "assist", opts.projectId ?? undefined);
  if (!quota.allowed) throw new StudioError("Quota de l'assistant atteint", "quota_exceeded", { used: quota.used, limit: quota.limit });
  const llm = getLLM();
  const generationId = await createGeneration({
    owner_id: opts.userId, artist_id: opts.artistId, project_id: opts.projectId, type: "assist",
    params_json: { word: opts.word }, effort: EFFORT.assist, model: llm.model,
  });
  try {
    const res = await llm.stream({
      task: "assist",
      system: assistSystem(loaded.ctx),
      messages: [{ role: "user", content: buildAssistRequest(opts) }],
      schema: AssistOutputSchema,
      effort: EFFORT.assist,
      maxTokens: MAX_TOKENS.assist,
    });
    if (!res.data) {
      await refundUsage(quota.event_id);
      await finishGeneration(generationId, res, { status: res.refusal ? "refused" : "error", startedAt, error: res.error });
      throw new StudioError("Suggestions indisponibles, réessaie.", "invalid_output");
    }
    // Ideas must stay original too
    const ideas = res.data.line_ideas.filter((l) => checkRecycling([l], loaded.index).every((v) => v.type !== "ngram"));
    await finishGeneration(generationId, res, { status: "done", output_json: res.data, startedAt });
    return { result: { ...res.data, line_ideas: ideas }, quota: { used: quota.used, limit: quota.limit } };
  } catch (e) {
    if (e instanceof StudioError) throw e;
    await refundUsage(quota.event_id);
    await finishGeneration(generationId, null, { status: "error", error: (e as Error).message, startedAt });
    throw new StudioError("Suggestions indisponibles, réessaie.", "provider_error");
  }
}

/** « Inspire-moi » : sujets tirés de l'ADN (thèmes inexplorés) — sans appel IA. */
export function inspirationFromDna(dna: ArtistDnaRow | null): string[] {
  return dna?.dna_json?.llm.unexplored_themes ?? [];
}
