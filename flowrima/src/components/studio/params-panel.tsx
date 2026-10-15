"use client";
import { useMemo, useState } from "react";
import { Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { targetSyllablesPerBar } from "@/lib/text/flow";
import { SECTION_LABELS } from "@/lib/text/parse";
import type { GenerateBodyT } from "@/lib/studio-schemas";
import { DEFAULT_BARS, relabel, type StudioDefaults } from "@/lib/studio-structure";
import { fmt, m } from "@/i18n";
import { cn } from "@/lib/utils";

export type GenerationParams = GenerateBodyT["params"];
type StructureItem = GenerationParams["structure"][number];
export type { StudioDefaults };
const TYPES: Array<StructureItem["type"]> = ["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"];

export function ParamsPanel({
  defaults,
  initial,
  submitting,
  onSubmit,
  quotaLeft,
}: {
  defaults: StudioDefaults;
  initial?: Partial<GenerationParams>;
  submitting: boolean;
  onSubmit: (p: GenerationParams) => void;
  quotaLeft: number | null;
}) {
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [workingTitle, setWorkingTitle] = useState(initial?.workingTitle ?? "");
  const [mood, setMood] = useState(initial?.mood ?? "");
  const [keyPhrase, setKeyPhrase] = useState(initial?.keyPhrase ?? "");
  const [inspireMe, setInspireMe] = useState(initial?.inspireMe ?? false);
  const [fidelity, setFidelity] = useState(initial?.fidelity ?? 70);
  const [structure, setStructure] = useState<StructureItem[]>(initial?.structure ?? defaults.structure);
  const [bpm, setBpm] = useState<number | null>(initial?.bpm ?? null);
  const [musicalKey, setMusicalKey] = useState(initial?.musicalKey ?? "");
  const [languages, setLanguages] = useState<string[]>(initial?.languages ?? defaults.languages);
  const [explicit, setExplicit] = useState(initial?.explicit ?? defaults.explicit);
  const [gimmick, setGimmick] = useState(initial?.allowedGimmick ?? "");
  const [styleReference, setStyleReference] = useState(initial?.styleReference ?? "");
  const [error, setError] = useState<string | null>(null);

  const target = useMemo(
    () => targetSyllablesPerBar({ genre: defaults.genre, bpm, artistAvg: defaults.artistSyllables }),
    [bpm, defaults.genre, defaults.artistSyllables],
  );
  const totalBars = structure.reduce((n, s) => n + s.bars, 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!inspireMe && subject.trim().length < 3) return setError("Indique un sujet ou choisis « Inspire-moi ».");
    if (!structure.length) return setError("Ajoute au moins une partie.");
    onSubmit({
      subject: subject.trim() || undefined,
      workingTitle: workingTitle.trim() || undefined,
      mood: mood.trim() || undefined,
      keyPhrase: keyPhrase.trim() || undefined,
      inspireMe,
      fidelity,
      structure,
      bpm,
      musicalKey: musicalKey.trim() || null,
      languages: languages.length ? languages : ["fr"],
      explicit,
      allowedGimmick: gimmick || null,
      styleReference: styleReference.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="subject">{m.studio.subject}</Label>
            <label className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-accent-text" aria-hidden /> {m.studio.inspireMe}
              <Switch checked={inspireMe} onCheckedChange={setInspireMe} aria-label={m.studio.inspireMe} />
            </label>
          </div>
          <Textarea
            id="subject"
            rows={2}
            maxLength={600}
            disabled={inspireMe}
            placeholder={inspireMe ? "L'IA choisit un sujet parmi tes thèmes inexplorés" : m.studio.subjectPlaceholder}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          {defaults.inspirations.length > 0 && !inspireMe && (
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Idées de sujets">
              {defaults.inspirations.slice(0, 6).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSubject(t)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-foreground"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="workingTitle">{m.studio.workingTitle} <span className="text-muted">({m.common.optional})</span></Label>
            <Input id="workingTitle" maxLength={120} value={workingTitle} onChange={(e) => setWorkingTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="keyPhrase">{m.studio.keyPhrase} <span className="text-muted">({m.common.optional})</span></Label>
            <Input id="keyPhrase" maxLength={200} value={keyPhrase} onChange={(e) => setKeyPhrase(e.target.value)} />
          </div>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{m.studio.mood}</legend>
          <div className="flex flex-wrap gap-2">
            {m.studio.moods.map((md) => (
              <button
                key={md}
                type="button"
                aria-pressed={mood === md}
                onClick={() => setMood(mood === md ? "" : md)}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm",
                  mood === md ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-foreground",
                )}
              >
                {md}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="fidelity">{m.studio.fidelity}</Label>
            <span className="text-sm font-semibold">{fidelity}/100</span>
          </div>
          <Slider id="fidelity" label={m.studio.fidelity} min={0} max={100} step={5} value={[fidelity]} onValueChange={([v]) => setFidelity(v)} />
          <FieldHint>{m.studio.fidelityHelp}</FieldHint>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">{m.studio.structure}</p>
          <span className="text-xs text-muted">{totalBars} mesures</span>
        </div>
        <ol className="space-y-2">
          {structure.map((s, i) => (
            <li key={i} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
              <Select
                aria-label={`Type de la partie ${i + 1}`}
                value={s.type}
                onChange={(e) => {
                  const type = e.target.value as StructureItem["type"];
                  setStructure((st) => relabel(st.map((x, k) => (k === i ? { ...x, type, bars: DEFAULT_BARS[type] } : x))));
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{SECTION_LABELS[t]}</option>
                ))}
              </Select>
              <div className="flex items-center gap-1">
                <Input
                  aria-label={`Mesures de ${s.label}`}
                  type="number"
                  min={1}
                  max={32}
                  value={s.bars}
                  onChange={(e) => {
                    const bars = Math.max(1, Math.min(32, Number(e.target.value) || 1));
                    setStructure((st) => st.map((x, k) => (k === i ? { ...x, bars } : x)));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${s.label}`}
                onClick={() => setStructure((st) => relabel(st.filter((_, k) => k !== i)))}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        {structure.length < 12 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStructure((st) => relabel([...st, { type: "couplet", bars: 16 }]))}
          >
            <Plus aria-hidden /> {m.studio.addSection}
          </Button>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="bpm">{m.studio.beat} — {m.studio.bpm}</Label>
            <Input
              id="bpm"
              type="number"
              inputMode="decimal"
              min={40}
              max={250}
              placeholder="ex. 92"
              value={bpm ?? ""}
              onChange={(e) => setBpm(e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div>
            <Label htmlFor="key">{m.studio.key}</Label>
            <Input id="key" maxLength={12} placeholder="ex. Fa mineur" value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} />
          </div>
        </div>
        <p className="rounded-xl bg-surface-2 p-3 text-sm">
          {fmt(m.studio.syllableTarget, { n: target.target })} <span className="text-muted">(±2 · {target.source.includes("artist") ? "d'après ton ADN" : "d'après le genre"}{bpm ? " et le BPM" : ""})</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{m.studio.languages}</legend>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(["fr", "en", ...defaults.languages])).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={languages.includes(l)}
                  onClick={() => setLanguages((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]))}
                  className={cn(
                    "h-9 rounded-full border px-3 text-sm uppercase",
                    languages.includes(l) ? "border-accent bg-accent text-accent-fg" : "border-border text-muted",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:self-end">
            <span className="text-sm">{m.studio.explicit}</span>
            <Switch checked={explicit} onCheckedChange={setExplicit} aria-label={m.studio.explicit} />
          </label>
        </div>
        {defaults.gimmicks.length > 0 && (
          <div>
            <Label htmlFor="gimmick">{m.studio.gimmick}</Label>
            <Select id="gimmick" value={gimmick} onChange={(e) => setGimmick(e.target.value)}>
              <option value="">Non (aucune reprise de tes phrases)</option>
              {defaults.gimmicks.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </Select>
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-sm text-accent-text">Référence de style (optionnel)</summary>
          <div className="mt-2">
            <Input
              aria-label="Référence de style"
              maxLength={200}
              placeholder="ex. une ambiance à la manière d'un rappeur de la côte Ouest"
              value={styleReference}
              onChange={(e) => setStyleReference(e.target.value)}
            />
            <FieldHint>Traduite en traits de style : jamais de reprise des paroles d&apos;un autre artiste.</FieldHint>
          </div>
        </details>
      </Card>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="sticky bottom-20 z-20 md:bottom-4">
        <Button type="submit" size="lg" className="w-full shadow-lg" disabled={submitting}>
          <Wand2 aria-hidden /> {submitting ? m.studio.generating : m.studio.generate}
        </Button>
        {quotaLeft !== null && quotaLeft !== -1 && (
          <p className="mt-2 text-center text-xs text-muted">{fmt(m.studio.quotaLeft, { n: quotaLeft })}</p>
        )}
      </div>
    </form>
  );
}
