"use client";
import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n";
import type { AssistOutput } from "@/lib/ai/schemas";
import type { RhymeSuggestion } from "@/lib/text/rhyme-dictionary";

const LEVEL = { 3: "Rimes riches", 2: "Rimes suffisantes", 1: "Assonances" } as const;

/**
 * Rhyme dictionary: instant local suggestions (free, artist vocabulary
 * first) + optional contextual AI suggestions (assist quota).
 */
export function RhymePanel({
  open,
  onOpenChange,
  word: initialWord,
  line,
  projectId,
  explicit,
  onPick,
  onReplaceLine,
  onQuota,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  word: string;
  line: string;
  projectId: string;
  explicit: boolean;
  onPick: (word: string) => void;
  onReplaceLine: (line: string) => void;
  onQuota: (message: string) => void;
}) {
  const [word, setWord] = useState(initialWord);
  const [local, setLocal] = useState<RhymeSuggestion[] | null>(null);
  const [ai, setAi] = useState<AssistOutput | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWord(initialWord);
    setAi(null);
  }, [initialWord, open]);

  useEffect(() => {
    if (!open || !word) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/rhymes?word=${encodeURIComponent(word)}`, { signal: ctrl.signal }).catch(() => null);
      const data = await res?.json().catch(() => null);
      setLocal(data?.rhymes ?? []);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [word, open]);

  async function askAi() {
    setLoadingAi(true);
    setAiError(null);
    const res = await fetch("/api/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, line, projectId, explicit }),
    }).catch(() => null);
    setLoadingAi(false);
    const data = await res?.json().catch(() => null);
    if (res?.status === 402) return onQuota(data?.error?.message ?? m.quota.blockedText);
    if (!res?.ok) return setAiError(data?.error?.message ?? m.common.error);
    setAi(data.result as AssistOutput);
  }

  const groups = ([3, 2, 1] as const).map((lvl) => ({ lvl, items: (local ?? []).filter((r) => r.level === lvl) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={m.studio.rhymeDictionary} description="Touche un mot pour l'utiliser en fin de ligne.">
        <Input aria-label="Mot à faire rimer" value={word} onChange={(e) => setWord(e.target.value.trim())} className="mb-4" />
        {local === null ? (
          <Loader2 className="size-5 animate-spin text-accent-text" aria-label={m.common.loading} />
        ) : local.length === 0 ? (
          <p className="text-sm text-muted">Aucune rime trouvée hors ligne : essaie les suggestions IA.</p>
        ) : (
          <div className="space-y-3">
            {groups.map(({ lvl, items }) =>
              items.length ? (
                <div key={lvl}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{LEVEL[lvl]}</p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((r) => (
                      <button
                        key={r.word}
                        type="button"
                        onClick={() => onPick(r.word)}
                        className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent"
                        title={r.multi >= 2 ? "rime multisyllabique" : undefined}
                      >
                        {r.word}
                        {r.fromArtist && <span className="ml-1 text-accent-text" aria-label="dans ton vocabulaire">•</span>}
                        {r.multi >= 2 && <span className="ml-1 text-xs text-muted">×{r.multi}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}
        <div className="mt-5 border-t border-border pt-4">
          {!ai ? (
            <Button variant="outline" className="w-full" onClick={askAi} disabled={loadingAi || !word}>
              {loadingAi ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {m.studio.aiSuggestions}
            </Button>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggestions IA ({m.common.aiGenerated.toLowerCase()})</p>
              <div className="flex flex-wrap gap-2">
                {ai.rhymes.map((r) => (
                  <button key={r.word} type="button" onClick={() => onPick(r.word)} className="rounded-full border border-border px-3 py-1.5 hover:border-accent">
                    {r.word} <span className="text-xs text-muted">{r.kind}</span>
                  </button>
                ))}
              </div>
              {ai.synonyms.length > 0 && <p><span className="font-medium">Synonymes : </span>{ai.synonyms.join(", ")}</p>}
              {ai.line_ideas.length > 0 && (
                <ul className="space-y-1">
                  {ai.line_ideas.map((l) => (
                    <li key={l}>
                      <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onReplaceLine(l)}>
                        « {l} »
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {aiError && <p role="alert" className="mt-2 text-sm text-danger">{aiError}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
