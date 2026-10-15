import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeTrackLyrics, aggregateCatalog, pickReferenceExcerpts, type CatalogMetrics } from "@/lib/text/analyze";
import { buildDnaPrompt, buildTrackDnaPrompt, type DnaTrackInput } from "@/lib/ai/prompts/dna";
import { DnaSchema, TrackDnaSchema, type DnaOutput, type TrackDnaOutput } from "@/lib/ai/schemas";
import { EFFORT, MAX_TOKENS, getLLM } from "@/lib/ai";
import type { LLMResult } from "@/lib/ai/types";
import type { ArtistProfileRow, JobRow, StoredDna, TrackRow } from "@/lib/db/types";
import { createGeneration, finishGeneration, flagModeration } from "./usage";

/**
 * DNA analysis pipeline, split in steps so that the Inngest job can retry
 * each one independently:
 *   1. prepareDnaInput  – code-computed measures for every track + catalogue
 *   2. callDnaDirect    – one streamed call, effort "high" (small catalogues)
 *      or submitDnaBatch/collectDnaBatch – Batch API, -50 % (large catalogues)
 *   3. saveDna          – versioned artist_dna row + generation log
 */

export const MIN_TRACKS_FOR_DNA = 1;
export const RECOMMENDED_TRACKS = 3;

export interface DnaInput {
  userId: string;
  artist: Pick<ArtistProfileRow, "id" | "stage_name" | "genres" | "languages">;
  tracks: DnaTrackInput[];
  trackIds: string[];
  catalog: CatalogMetrics;
  excerpts: Array<{ title: string; lines: string[] }>;
}

export async function updateJob(jobId: string, patch: Partial<Pick<JobRow, "status" | "progress" | "message" | "result" | "error">>) {
  await createAdminClient().from("jobs").update(patch as never).eq("id", jobId);
}

export async function prepareDnaInput(userId: string, artistId: string): Promise<DnaInput> {
  const db = createAdminClient();
  const { data: artist, error: aErr } = await db
    .from("artist_profiles")
    .select("id, stage_name, genres, languages, owner_id")
    .eq("id", artistId)
    .single();
  if (aErr || !artist || (artist as { owner_id: string }).owner_id !== userId) throw new Error("artist_not_found");

  const { data: rows } = await db
    .from("tracks")
    .select("*")
    .eq("artist_id", artistId)
    .eq("owner_id", userId)
    .order("release_date", { ascending: true, nullsFirst: true });
  const tracks = ((rows as TrackRow[] | null) ?? []).filter((t) => (t.lyrics ?? "").trim().split("\n").length >= 2);
  if (tracks.length < MIN_TRACKS_FOR_DNA) throw new Error("not_enough_tracks");

  const inputs: DnaTrackInput[] = [];
  for (const t of tracks) {
    const analysis = analyzeTrackLyrics(t.lyrics!);
    inputs.push({ title: t.title, releaseDate: t.release_date, lyrics: t.lyrics!, analysis });
    // Store the code-computed analysis per track (track_analyses)
    await db.from("track_analyses").upsert(
      {
        owner_id: userId,
        track_id: t.id,
        structure_json: analysis.structure,
        rhymes_json: analysis.rhymes,
        syllables_json: analysis.syllables,
        stats_json: {
          words: analysis.words,
          adlibs: analysis.adlibs,
          language: analysis.language,
          englishShare: analysis.englishShare,
          sections: analysis.sections,
          lineCount: analysis.lineCount,
          wordCount: analysis.wordCount,
        },
        bpm: t.bpm_manual,
        analyzer_version: analysis.version,
      } as never,
      { onConflict: "track_id" },
    );
  }
  await db.from("tracks").update({ analysis_status: "done" } as never).in("id", tracks.map((t) => t.id));

  const catalog = aggregateCatalog(
    inputs.map((i) => ({ title: i.title, releaseDate: i.releaseDate, lyrics: i.lyrics, analysis: i.analysis })),
  );
  const excerpts = pickReferenceExcerpts(
    inputs.map((i) => ({ title: i.title, lyrics: i.lyrics })),
    catalog.vocabulary.signatureWords.map((w) => w.word),
    5,
  );
  const a = artist as ArtistProfileRow;
  return {
    userId,
    artist: { id: a.id, stage_name: a.stage_name, genres: a.genres, languages: a.languages },
    tracks: inputs,
    trackIds: tracks.map((t) => t.id),
    catalog,
    excerpts,
  };
}

function dnaPrompt(input: DnaInput, trackSummaries?: Array<{ title: string; summary: unknown }>) {
  return buildDnaPrompt({
    stageName: input.artist.stage_name,
    genres: input.artist.genres,
    languages: input.artist.languages,
    tracks: input.tracks,
    catalog: input.catalog,
    trackSummaries,
  });
}

export async function callDnaDirect(input: DnaInput): Promise<LLMResult<DnaOutput>> {
  const { system, user } = dnaPrompt(input);
  return getLLM().stream({
    task: "dna",
    system,
    messages: [{ role: "user", content: user }],
    schema: DnaSchema,
    effort: EFFORT.dna,
    maxTokens: MAX_TOKENS.dna,
  });
}

/** Large catalogues: per-track analyses + the catalogue DNA in one batch (-50 %). */
export async function submitDnaBatch(input: DnaInput): Promise<string> {
  const llm = getLLM();
  const { system, user } = dnaPrompt(input);
  const items = [
    {
      customId: "dna",
      request: {
        task: "dna" as const, system, messages: [{ role: "user" as const, content: user }],
        schema: DnaSchema, effort: EFFORT.dna, maxTokens: MAX_TOKENS.dna,
      },
    },
    ...input.tracks.map((t, i) => {
      const p = buildTrackDnaPrompt(t);
      return {
        customId: `track_${i}`,
        request: {
          task: "dna_track" as const, system: p.system, messages: [{ role: "user" as const, content: p.user }],
          schema: TrackDnaSchema, effort: EFFORT.dna_track, maxTokens: MAX_TOKENS.dna_track,
        },
      };
    }),
  ];
  return llm.submitBatch(items as never);
}

export async function collectDnaBatch(
  batchId: string,
  input: DnaInput,
): Promise<{ dna: LLMResult<DnaOutput> | null; perTrack: Array<{ trackId: string; result: LLMResult<TrackDnaOutput> }> }> {
  const llm = getLLM();
  const dnaResults = await llm.batchResults(batchId, DnaSchema);
  const trackResults = await llm.batchResults(batchId, TrackDnaSchema);
  const perTrack = input.trackIds
    .map((trackId, i) => ({ trackId, result: trackResults.get(`track_${i}`)! }))
    .filter((x) => x.result);
  // Per-track themes are stored on track_analyses.themes_json (track page).
  const db = createAdminClient();
  for (const { trackId, result } of perTrack) {
    if (result.data) await db.from("track_analyses").update({ themes_json: result.data } as never).eq("track_id", trackId);
  }
  return { dna: dnaResults.get("dna") ?? null, perTrack };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

/** Normalises the model output (ranges and sizes that the API cannot enforce). */
export function normalizeDna(d: DnaOutput, metrics: CatalogMetrics): DnaOutput {
  return {
    ...d,
    signature_points: d.signature_points.slice(0, 5),
    themes: d.themes.map((t) => ({ ...t, weight: clamp01(t.weight) })).sort((a, b) => b.weight - a.weight).slice(0, 10),
    emotions: d.emotions.map((e) => ({ ...e, weight: clamp01(e.weight) })),
    languages: d.languages.map((l) => ({ ...l, share: clamp01(l.share) })),
    // the measured value wins over the model's estimate
    flow: { ...d.flow, syllables_per_bar: metrics.syllablesPerBar.avg || d.flow.syllables_per_bar },
  };
}

export async function saveDna(params: {
  input: DnaInput;
  jobId: string;
  result: LLMResult<DnaOutput> | null;
  batch: boolean;
  extraUsage?: Array<LLMResult<unknown>>;
  startedAt: number;
}): Promise<{ version: number; ok: boolean; error?: string }> {
  const { input, result } = params;
  const db = createAdminClient();
  const generationId = await createGeneration({
    owner_id: input.userId,
    artist_id: input.artist.id,
    type: "dna",
    params_json: { tracks: input.tracks.length, batch: params.batch },
    effort: EFFORT.dna,
    model: result?.model ?? getLLM().model,
  });

  // Total usage for cost logging (aggregate + per-track batch items)
  const all = [result, ...(params.extraUsage ?? [])].filter(Boolean) as Array<LLMResult<unknown>>;
  const usage = all.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.usage.cacheWriteTokens,
      cacheWrite1hTokens: acc.cacheWrite1hTokens + r.usage.cacheWrite1hTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 },
  );
  const logResult = result ? { ...result, usage } : null;

  const { data: last } = await db
    .from("artist_dna")
    .select("version")
    .eq("artist_id", input.artist.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((last as { version: number } | null)?.version ?? 0) + 1;

  if (!result || result.refusal || !result.data) {
    const error = result?.refusal ? "refused" : result?.error ?? "no_result";
    await finishGeneration(generationId, logResult, {
      status: result?.refusal ? "refused" : "error",
      error,
      startedAt: params.startedAt,
      batch: params.batch,
    });
    if (result?.refusal) {
      await flagModeration({
        user_id: input.userId, generation_id: generationId, source: "refusal",
        category: result.refusal.category, reason: "Analyse ADN refusée par le modèle",
      });
    }
    await db.from("artist_dna").insert({
      owner_id: input.userId, artist_id: input.artist.id, version, status: "error",
      track_count: input.tracks.length, error, job_id: params.jobId, model: result?.model ?? null,
    } as never);
    return { version, ok: false, error };
  }

  const llm = normalizeDna(result.data, input.catalog);
  const stored: StoredDna = { llm, metrics: input.catalog, excerpts: input.excerpts };
  await db.from("artist_dna").insert({
    owner_id: input.userId,
    artist_id: input.artist.id,
    version,
    status: "ready",
    dna_json: stored,
    summary: llm.summary,
    reliability_score: input.catalog.reliability,
    track_count: input.tracks.length,
    model: result.model,
    job_id: params.jobId,
  } as never);
  await finishGeneration(generationId, logResult, {
    status: "done",
    output_json: { version },
    startedAt: params.startedAt,
    batch: params.batch,
  });
  return { version, ok: true };
}
