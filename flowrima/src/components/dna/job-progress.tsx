"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Progress } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface JobState {
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string | null;
  error: string | null;
}

/**
 * Live status of a background job: Supabase Realtime (RLS-filtered) with a
 * polling fallback every 3 s.
 */
export function JobProgress({ jobId, initial, onDone }: { jobId: string; initial?: Partial<JobState>; onDone?: () => void }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState>({
    status: initial?.status ?? "queued",
    progress: initial?.progress ?? 0,
    message: initial?.message ?? "En file d'attente…",
    error: initial?.error ?? null,
  });

  useEffect(() => {
    let stopped = false;
    const supabase = createClient();
    const channel = supabase
      .channel(`job-${jobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, (payload) => {
        setJob((j) => ({ ...j, ...(payload.new as Partial<JobState>) }));
      })
      .subscribe();
    const poll = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || stopped) return;
      const data = (await res.json()) as JobState;
      setJob((j) => ({ ...j, ...data }));
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [jobId]);

  useEffect(() => {
    if (job.status === "done") {
      onDone?.();
      router.refresh();
    }
  }, [job.status, onDone, router]);

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        {job.status === "done" ? (
          <CheckCircle2 className="size-5 text-success" aria-hidden />
        ) : job.status === "error" ? (
          <TriangleAlert className="size-5 text-danger" aria-hidden />
        ) : (
          <Loader2 className="size-5 animate-spin text-accent-text" aria-hidden />
        )}
        <span>{job.status === "error" ? job.message ?? "L'analyse a échoué" : job.message}</span>
      </div>
      <Progress value={job.status === "done" ? 100 : Math.max(5, job.progress)} label="Progression de l'analyse" />
      {job.status === "error" && job.error && <p className="text-xs text-muted">Détail : {job.error}. Ta consommation a été recréditée.</p>}
    </div>
  );
}
