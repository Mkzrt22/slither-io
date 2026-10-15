"use client";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { requestDnaAnalysis } from "@/lib/actions/dna";
import { JobProgress } from "./job-progress";

export function AnalyzeButton({ label, activeJobId }: { label: string; activeJobId?: string | null }) {
  const [jobId, setJobId] = useState<string | null>(activeJobId ?? null);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (jobId) return <JobProgress jobId={jobId} />;
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await requestDnaAnalysis();
          if (res?.ok && res.jobId) setJobId(res.jobId);
          else toast(res?.message ?? "Erreur", "error");
        })
      }
    >
      <Sparkles aria-hidden /> {pending ? "Lancement…" : label}
    </Button>
  );
}
