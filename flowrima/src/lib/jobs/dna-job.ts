import "server-only";
import { env, llmIsMock } from "@/lib/env";
import { getLLM } from "@/lib/ai";
import type { LLMResult } from "@/lib/ai/types";
import type { DnaOutput } from "@/lib/ai/schemas";
import {
  callDnaDirect, collectDnaBatch, prepareDnaInput, saveDna, submitDnaBatch, updateJob, type DnaInput,
} from "@/lib/services/dna";
import { refundUsage } from "@/lib/services/usage";
import { inngest, EVENTS, type DnaRequestedData } from "./client";

/** Large catalogues go through the Batch API (-50 %), small ones are streamed (< 2 min). */
export function useBatch(trackCount: number): boolean {
  return !llmIsMock() && trackCount >= env().DNA_BATCH_THRESHOLD;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const dnaAnalysisJob = inngest.createFunction(
  {
    id: "dna-analysis",
    name: "Analyse ADN artistique",
    triggers: [{ event: EVENTS.dnaRequested }],
    // One analysis at a time per user; retries are per step.
    concurrency: { key: "event.data.userId", limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const data = (event.data as unknown as { event: { data: DnaRequestedData } }).event.data;
      await updateJob(data.jobId, { status: "error", error: errorMessage(error), message: "L'analyse a échoué" });
      await refundUsage(data.usageEventId);
    },
  },
  async ({ event, step }) => {
    const data = event.data as DnaRequestedData;
    const startedAt = Date.now();

    await step.run("start", () =>
      updateJob(data.jobId, { status: "running", progress: 10, message: "Lecture de tes textes…" }),
    );
    const input = (await step.run("prepare", () => prepareDnaInput(data.userId, data.artistId))) as unknown as DnaInput;
    await step.run("prepared", () =>
      updateJob(data.jobId, {
        progress: 35,
        message: `Syllabes, rimes et structure calculées sur ${input.tracks.length} titre(s). L'IA analyse ton style…`,
      }),
    );

    let result: LLMResult<DnaOutput> | null;
    let extra: Array<LLMResult<unknown>> = [];
    const batch = useBatch(input.tracks.length);

    if (batch) {
      const batchId = await step.run("submit-batch", () => submitDnaBatch(input));
      await step.run("batch-submitted", () =>
        updateJob(data.jobId, { progress: 45, message: "Gros catalogue : analyse en lot (jusqu'à quelques heures)…" }),
      );
      for (let i = 0; i < 60; i++) {
        const status = await step.run(`poll-${i}`, () => getLLM().batchStatus(batchId));
        if (status === "ended") break;
        await step.sleep(`wait-${i}`, i < 6 ? "2m" : "20m");
      }
      const collected = (await step.run("collect-batch", () => collectDnaBatch(batchId, input))) as unknown as Awaited<
        ReturnType<typeof collectDnaBatch>
      >;
      result = collected.dna;
      extra = collected.perTrack.map((p) => p.result as LLMResult<unknown>);
    } else {
      result = (await step.run("analyze", () => callDnaDirect(input))) as unknown as LLMResult<DnaOutput>;
    }

    const saved = await step.run("save", () =>
      saveDna({ input, jobId: data.jobId, result, batch, extraUsage: extra, startedAt }),
    );
    await step.run("finish", async () => {
      if (saved.ok) {
        await updateJob(data.jobId, { status: "done", progress: 100, message: "Ton ADN est prêt", result: { version: saved.version } });
      } else {
        await updateJob(data.jobId, { status: "error", progress: 100, error: saved.error, message: "L'analyse n'a pas abouti" });
        await refundUsage(data.usageEventId);
      }
    });
    return saved;
  },
);

/**
 * Same pipeline without a queue (local development without Inngest): runs in
 * the background of the request with next/server `after()`.
 */
export async function runDnaInline(data: DnaRequestedData): Promise<void> {
  const startedAt = Date.now();
  try {
    await updateJob(data.jobId, { status: "running", progress: 10, message: "Lecture de tes textes…" });
    const input = await prepareDnaInput(data.userId, data.artistId);
    await updateJob(data.jobId, { progress: 35, message: "L'IA analyse ton style…" });
    const result = await callDnaDirect(input);
    const saved = await saveDna({ input, jobId: data.jobId, result, batch: false, startedAt });
    if (saved.ok) {
      await updateJob(data.jobId, { status: "done", progress: 100, message: "Ton ADN est prêt", result: { version: saved.version } });
    } else {
      await updateJob(data.jobId, { status: "error", progress: 100, error: saved.error, message: "L'analyse n'a pas abouti" });
      await refundUsage(data.usageEventId);
    }
  } catch (e) {
    await updateJob(data.jobId, { status: "error", error: errorMessage(e), message: "L'analyse a échoué" });
    await refundUsage(data.usageEventId);
  }
}
