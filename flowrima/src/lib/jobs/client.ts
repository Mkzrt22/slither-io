import { Inngest } from "inngest";

/** Inngest client. Event key / signing key come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY. */
export const inngest = new Inngest({ id: "flowrima" });

export const EVENTS = {
  dnaRequested: "dna/analysis.requested",
} as const;

export interface DnaRequestedData {
  userId: string;
  artistId: string;
  jobId: string;
  usageEventId?: string;
}

/** True when a queue is available (Inngest Cloud keys, or the local dev server). */
export function queueConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV);
}
