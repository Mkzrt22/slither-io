"use client";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LyricsView } from "@/components/lyrics/lyrics-view";
import { m } from "@/i18n";
import type { GenStatus, PartialOutput } from "./use-generation";

type PartialProposal = NonNullable<PartialOutput["proposals"]>[number];

function sectionsOf(p: PartialProposal) {
  return (p.sections ?? [])
    .filter((s) => s && Array.isArray(s.lines))
    .map((s) => ({
      label: s.label ?? "…",
      type: s.type,
      flow: s.flow?.pace ? { pace: s.flow.pace, notes: s.flow.notes ?? "" } : undefined,
      lines: (s.lines ?? []).filter((l): l is string => typeof l === "string"),
    }));
}

function LiveProposal({ p, target }: { p: PartialProposal; target?: { min: number; max: number } }) {
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
          {p.variant ? m.studio.variants[p.variant] : "…"}
        </p>
        <h3 className="text-lg font-semibold">{p.title ?? "…"}</h3>
        {p.angle && <p className="text-sm text-muted">{p.angle}</p>}
      </div>
      <LyricsView sections={sectionsOf(p)} target={target} />
    </Card>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

export function GenerationView({
  status,
  partial,
  startedAt,
  onCancel,
  target,
}: {
  status: GenStatus;
  partial: PartialOutput | null;
  startedAt: number | null;
  onCancel: () => void;
  target?: { min: number; max: number };
}) {
  const proposals = (partial?.proposals ?? []).filter(Boolean);
  return (
    <div className="space-y-4" aria-live="polite" aria-busy={status !== "done"}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3 text-sm">
          {status === "checking" ? (
            <ShieldCheck className="size-5 text-accent-text" aria-hidden />
          ) : (
            <Loader2 className="size-5 animate-spin text-accent-text" aria-hidden />
          )}
          <span>
            {status === "thinking" && m.studio.thinking}
            {status === "writing" && `${m.studio.generating} (${proposals.length}/3)`}
            {status === "checking" && "Vérification anti-recyclage et enregistrement…"}
          </span>
          {startedAt && <span className="text-muted">· <Elapsed since={startedAt} /></span>}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Square aria-hidden /> Arrêter
        </Button>
      </div>
      {proposals.length > 0 && (
        <>
          <div className="hidden gap-4 lg:grid lg:grid-cols-3">
            {proposals.map((p, i) => (
              <LiveProposal key={i} p={p} target={target} />
            ))}
          </div>
          <Tabs defaultValue="0" className="lg:hidden">
            <TabsList>
              {proposals.map((p, i) => (
                <TabsTrigger key={i} value={String(i)}>{p.variant ?? i + 1}</TabsTrigger>
              ))}
            </TabsList>
            {proposals.map((p, i) => (
              <TabsContent key={i} value={String(i)} className="mt-3">
                <LiveProposal p={p} target={target} />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  );
}
