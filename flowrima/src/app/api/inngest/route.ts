import { serve } from "inngest/next";
import { inngest } from "@/lib/jobs/client";
import { dnaAnalysisJob } from "@/lib/jobs/dna-job";

// Long AI steps (DNA analysis with effort "high"). Vercel Pro + Fluid compute allows up to 800 s.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [dnaAnalysisJob],
});
