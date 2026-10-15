"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookA, Check, ChevronDown, CornerDownLeft, Loader2, Plus, RefreshCw, Trash2, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RhymeLetter, SegmentView, SyllableBadge } from "@/components/lyrics/lyrics-view";
import { renderSections } from "@/lib/text/render";
import { countLineSyllables } from "@/lib/text/syllables";
import { barSeconds, formatTime, sectionUsesTarget, targetSyllablesPerBar } from "@/lib/text/flow";
import { SECTION_LABELS, type SectionType } from "@/lib/text/parse";
import { saveWorkingCopy } from "@/lib/actions/projects";
import type { LyricContent, LyricSection } from "@/lib/db/types";
import { RETOUCH_ACTION_IDS } from "@/lib/studio-schemas";
import { m } from "@/i18n";
import { cn } from "@/lib/utils";
import { RhymePanel } from "./rhyme-panel";

type Action = (typeof RETOUCH_ACTION_IDS)[number];
const LINE_ACTIONS: Action[] = ["regenerate", "punchier", "darker", "richer_rhymes", "simpler", "double_meaning"];
const SECTION_TYPES: LyricSection["type"][] = ["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"];
const REMOVED_PREFIX = "[ligne retirée";

const lastWord = (line: string) =>
  (line.replace(/\([^)]*\)/g, " ").match(/[\p{L}'’-]+(?=[^\p{L}]*$)/u)?.[0] ?? "").replace(/^[a-z]'/i, "");

function AutoTextarea({ value, onChange, onDone, label }: { value: string; onChange: (v: string) => void; onDone: () => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={value}
      maxLength={300}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
      className="lyrics w-full resize-none rounded-lg border border-accent bg-surface px-2 py-1 focus-visible:outline-none"
    />
  );
}

export function LyricsEditor({
  projectId,
  initial,
  bpm,
  genre,
  artistSyllables,
  explicit,
  onQuota,
  onSaved,
  onChange,
}: {
  projectId: string;
  initial: LyricContent;
  bpm: number | null;
  genre: string;
  artistSyllables: number | null;
  explicit: boolean;
  onQuota: (message: string) => void;
  onSaved?: (versionId: string, ratio: number) => void;
  onChange?: (content: LyricContent) => void;
}) {
  const toast = useToast();
  const [content, setContent] = useState<LyricContent>(initial);
  const [history, setHistory] = useState<LyricContent[]>([]);
  const [editing, setEditing] = useState<{ si: number; li: number } | null>(null);
  const [busy, setBusy] = useState<{ si: number; li?: number } | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [rhymeFor, setRhymeFor] = useState<{ si: number; li: number } | null>(null);
  const firstRender = useRef(true);

  const target = useMemo(() => targetSyllablesPerBar({ genre, bpm, artistAvg: artistSyllables }), [genre, bpm, artistSyllables]);
  const rendered = useMemo(() => renderSections(content.sections), [content]);

  // Latest content for callbacks (kept in sync after each render, and eagerly by update()).
  const contentRef = useRef(content);
  useLayoutEffect(() => {
    contentRef.current = content;
  }, [content]);
  // Absolute bar number of each section's first line.
  const sectionStarts = useMemo(() => {
    const starts: number[] = [];
    let n = 0;
    for (const sec of content.sections) {
      starts.push(n);
      n += sec.lines.length;
    }
    return starts;
  }, [content]);

  /** Every change goes through here (undo history, max 30 steps). */
  const update = useCallback((fn: (c: LyricContent) => LyricContent, record = true) => {
    const prev = contentRef.current;
    if (record) setHistory((h) => [...h.slice(-29), prev]);
    const next = fn(structuredClone(prev));
    contentRef.current = next;
    setContent(next);
  }, []);

  /** Entering edit mode records one undo step (not one per keystroke). */
  const startEditing = (si: number, li: number) => {
    setHistory((h) => [...h.slice(-29), contentRef.current]);
    setEditing({ si, li });
  };

  useEffect(() => {
    onChange?.(content);
  }, [content, onChange]);

  // Autosave (debounced)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSave("saving");
    const t = setTimeout(async () => {
      const res = await saveWorkingCopy(projectId, content).catch(() => null);
      if (res?.ok) {
        setSave("saved");
        onSaved?.(res.versionId, res.ratio);
      } else setSave("error");
    }, 1500);
    return () => clearTimeout(t);
  }, [content, projectId, onSaved]);

  const setLine = (si: number, li: number, text: string, record = true) =>
    update((c) => {
      c.sections[si].lines[li] = text;
      return c;
    }, record);

  async function retouch(action: Action, si: number, lineIndexes: number[]) {
    setBusy({ si, li: lineIndexes.length === 1 ? lineIndexes[0] : undefined });
    const song = contentRef.current;
    const single = lineIndexes.length === 1 ? song.sections[si].lines[lineIndexes[0]] : null;
    const res = await fetch("/api/generate/retouch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        action,
        song: song.sections.map((s) => ({ type: s.type, label: s.label, bars: s.lines.length, lines: s.lines })),
        sectionIndex: si,
        lineIndexes,
        keepRhyme: single && action !== "richer_rhymes" ? lastWord(single) || null : null,
        bpm,
        explicit,
      }),
    }).catch(() => null);
    setBusy(null);
    const data = await res?.json().catch(() => null);
    if (res?.status === 402) return onQuota(data?.error?.message ?? m.quota.blockedText);
    if (!res?.ok) return toast(data?.error?.message ?? m.common.error, "error");
    const lines: string[] = data.lines;
    update((c) => {
      lineIndexes.forEach((li, k) => {
        if (lines[k] !== undefined) c.sections[si].lines[li] = lines[k];
      });
      return c;
    });
    if (data.note) toast(data.note);
  }

  const totalBars = content.sections.reduce((n, s) => n + s.lines.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          {totalBars} mesures{bpm ? ` · ${formatTime(totalBars * barSeconds(bpm))} à ${bpm} BPM` : ""} · cible {target.min}–{target.max} syll.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted" aria-live="polite">
            {save === "saving" ? m.common.saving : save === "saved" ? m.common.saved : save === "error" ? "Échec de la sauvegarde" : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!history.length}
            onClick={() => {
              setHistory((h) => {
                const prev = h.at(-1);
                if (prev) setContent(prev);
                return h.slice(0, -1);
              });
            }}
          >
            <Undo2 aria-hidden /> Annuler
          </Button>
        </div>
      </div>

      {rendered.map((section, si) => {
        const raw = content.sections[si];
        const sectionStart = sectionStarts[si];
        return (
          <Card key={si} className="space-y-2 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Select
                  aria-label={`Type de ${raw.label}`}
                  className="h-9 w-auto text-sm font-semibold text-accent-text"
                  value={raw.type}
                  onChange={(e) =>
                    update((c) => {
                      const type = e.target.value as LyricSection["type"];
                      c.sections[si].type = type;
                      c.sections[si].label = SECTION_LABELS[type as SectionType];
                      return c;
                    })
                  }
                >
                  {SECTION_TYPES.map((t) => (
                    <option key={t} value={t}>{SECTION_LABELS[t as SectionType]}</option>
                  ))}
                </Select>
                <span className="text-xs text-muted">
                  {raw.lines.length} mes.{bpm ? ` · ${formatTime(sectionStart * barSeconds(bpm))}` : ""}
                  {raw.flow ? ` · débit ${raw.flow.pace}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {busy?.si === si && busy.li === undefined && <Loader2 className="size-4 animate-spin text-accent-text" aria-label="Retouche en cours" />}
                <Select
                  aria-label={`Retoucher ${raw.label}`}
                  className="h-9 w-auto text-sm"
                  value=""
                  disabled={!!busy}
                  onChange={(e) => {
                    const a = e.target.value as Action;
                    if (a) void retouch(a, si, raw.lines.map((_, i) => i));
                  }}
                >
                  <option value="">{m.studio.regenerateSection}…</option>
                  {RETOUCH_ACTION_IDS.map((a) => (
                    <option key={a} value={a}>{m.studio.actions[a]}</option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Supprimer ${raw.label}`}
                  onClick={() => confirm(`Supprimer « ${raw.label} » ?`) && update((c) => ({ ...c, sections: c.sections.filter((_, k) => k !== si) }))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
            {raw.flow?.notes && <p className="text-xs text-muted">{raw.flow.notes}</p>}

            <ol className="space-y-0.5">
              {section.lines.map((line, li) => {
                const isEditing = editing?.si === si && editing.li === li;
                const isBusy = busy?.si === si && busy.li === li;
                const removed = raw.lines[li]?.startsWith(REMOVED_PREFIX);
                const liveCount = isEditing ? countLineSyllables(raw.lines[li]) : null;
                const live = liveCount ? { syllables: liveCount.count, min: liveCount.min, max: liveCount.max } : null;
                return (
                  <li key={li} className={cn("rounded-lg", isEditing && "bg-surface-2 p-2")}>
                    <div className="grid grid-cols-[1.5rem_1fr_auto_auto] items-baseline gap-2">
                      <span className="text-right font-mono text-[10px] text-muted" aria-label={`mesure ${sectionStart + li + 1}`}>
                        {sectionStart + li + 1}
                      </span>
                      {isEditing ? (
                        <AutoTextarea
                          label={`Ligne ${li + 1} de ${raw.label}`}
                          value={raw.lines[li]}
                          onChange={(v) => setLine(si, li, v, false)}
                          onDone={() => setEditing(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditing(si, li)}
                          className={cn(
                            "lyrics min-w-0 break-words rounded px-1 text-left hover:bg-surface-2",
                            removed && "italic text-warning",
                            isBusy && "animate-pulse-soft",
                          )}
                          aria-label={`Modifier la ligne : ${line.text}`}
                        >
                          {line.text ? line.segments.map((seg, k) => <SegmentView key={k} seg={seg} />) : <span className="text-muted">(ligne vide)</span>}
                        </button>
                      )}
                      <SyllableBadge line={live ?? line} target={sectionUsesTarget(raw.type) ? target : undefined} />
                      <RhymeLetter family={line.family} colorIndex={line.colorIndex} />
                    </div>
                    {isEditing && (
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                        {LINE_ACTIONS.map((a) => (
                          <Button key={a} size="sm" variant="secondary" disabled={!!busy} onClick={() => retouch(a, si, [li])}>
                            {a === "regenerate" && <RefreshCw aria-hidden />}
                            {m.studio.actions[a]}
                          </Button>
                        ))}
                        <Button size="sm" variant="secondary" onClick={() => setRhymeFor({ si, li })}>
                          <BookA aria-hidden /> Rimes
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            update((c) => {
                              c.sections[si].lines.splice(li + 1, 0, "");
                              return c;
                            });
                            setEditing({ si, li: li + 1 });
                          }}
                        >
                          <CornerDownLeft aria-hidden /> Ligne
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Supprimer la ligne"
                          onClick={() => {
                            update((c) => {
                              c.sections[si].lines.splice(li, 1);
                              return c;
                            });
                            setEditing(null);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                        <Button size="sm" onClick={() => setEditing(null)}>
                          <Check aria-hidden /> OK
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                update((c) => {
                  c.sections[si].lines.push("");
                  return c;
                });
                setEditing({ si, li: raw.lines.length });
              }}
            >
              <Plus aria-hidden /> Ajouter une ligne
            </Button>
          </Card>
        );
      })}

      <div className="flex flex-wrap gap-2">
        {(["couplet", "refrain", "pont", "outro"] as const).map((t) => (
          <Button
            key={t}
            variant="outline"
            size="sm"
            onClick={() =>
              update((c) => ({
                ...c,
                sections: [...c.sections, { type: t, label: SECTION_LABELS[t], bars: 0, lines: [""] }],
              }))
            }
          >
            <Plus aria-hidden /> {SECTION_LABELS[t]}
          </Button>
        ))}
      </div>
      <details className="text-xs text-muted">
        <summary className="inline-flex cursor-pointer items-center gap-1">
          <ChevronDown className="size-3" aria-hidden /> Légende
        </summary>
        <p className="mt-1">
          Chiffre à droite = syllabes (orange si hors cible). Lettre = famille de rimes (même couleur = même rime). « / » = respiration. Entre
          parenthèses = ad-libs. Touche une ligne pour la modifier ou la retoucher.
        </p>
      </details>

      {rhymeFor && (
        <RhymePanel
          open
          onOpenChange={(o) => !o && setRhymeFor(null)}
          word={lastWord(content.sections[rhymeFor.si]?.lines[rhymeFor.li] ?? "")}
          line={content.sections[rhymeFor.si]?.lines[rhymeFor.li] ?? ""}
          projectId={projectId}
          explicit={explicit}
          onQuota={onQuota}
          onPick={(w) => {
            const { si, li } = rhymeFor;
            const current = content.sections[si].lines[li];
            const lw = lastWord(current);
            const idx = lw ? current.lastIndexOf(lw) : -1;
            setLine(si, li, idx >= 0 ? current.slice(0, idx) + w + current.slice(idx + lw.length) : `${current} ${w}`.trim());
            setRhymeFor(null);
          }}
          onReplaceLine={(l) => {
            setLine(rhymeFor.si, rhymeFor.li, l);
            setRhymeFor(null);
          }}
        />
      )}
    </div>
  );
}
