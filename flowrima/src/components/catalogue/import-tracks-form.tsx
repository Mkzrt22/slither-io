"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { FileUp, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { importTracks, type TrackInput } from "@/lib/actions/tracks";
import { countLineSyllables } from "@/lib/text/syllables";
import { parseLyrics } from "@/lib/text/parse";
import { m } from "@/i18n";

interface Draft extends TrackInput {
  key: number;
}

const empty = (key: number): Draft => ({
  key,
  title: "",
  lyrics: "",
  releaseDate: null,
  link: null,
  coverUrl: null,
  durationSeconds: null,
  bpm: null,
  explicit: false,
  source: "paste",
});

function LyricsStats({ lyrics }: { lyrics: string }) {
  const stats = useMemo(() => {
    if (lyrics.trim().length < 20) return null;
    const sections = parseLyrics(lyrics);
    const lines = sections.flatMap((s) => s.lines);
    const avg = lines.reduce((s, l) => s + countLineSyllables(l).count, 0) / Math.max(1, lines.length);
    return { lines: lines.length, sections: sections.length, avg: Math.round(avg * 10) / 10 };
  }, [lyrics]);
  if (!stats) return null;
  return (
    <FieldHint>
      {stats.lines} lignes · {stats.sections} partie(s) détectée(s) · ~{stats.avg} syllabes par ligne
    </FieldHint>
  );
}

function TrackCard({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: Draft;
  index: number;
  onChange: (patch: Partial<Draft>) => void;
  onRemove?: () => void;
}) {
  const toast = useToast();
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = (s: string) => `t${draft.key}-${s}`;

  async function fetchMeta() {
    if (!draft.link) return;
    setLoadingMeta(true);
    const res = await fetch("/api/tracks/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: draft.link }),
    }).catch(() => null);
    setLoadingMeta(false);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data) return toast(data?.error?.message ?? m.common.error, "error");
    onChange({
      title: draft.title || data.title || "",
      coverUrl: data.coverUrl,
      releaseDate: draft.releaseDate ?? data.releaseDate,
      durationSeconds: data.durationSeconds,
    });
  }

  async function readFile(file: File) {
    setLoadingFile(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/tracks/parse-file", { method: "POST", body: fd }).catch(() => null);
    setLoadingFile(false);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data) return toast(data?.error?.message ?? m.common.error, "error");
    onChange({ lyrics: data.text, title: draft.title || data.title, source: "file" });
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Titre {index + 1}</p>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Retirer le titre ${index + 1}`}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
      <div>
        <Label htmlFor={id("link")}>{m.catalogue.platformLink} <span className="text-muted">({m.common.optional})</span></Label>
        <div className="flex gap-2">
          <Input
            id={id("link")}
            type="url"
            inputMode="url"
            placeholder="https://open.spotify.com/track/…"
            value={draft.link ?? ""}
            onChange={(e) => onChange({ link: e.target.value || null })}
          />
          <Button type="button" variant="outline" onClick={fetchMeta} disabled={!draft.link || loadingMeta} aria-label={m.catalogue.fetchMetadata}>
            {loadingMeta ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 aria-hidden />}
            <span className="hidden sm:inline">{m.catalogue.fetchMetadata}</span>
          </Button>
        </div>
        <FieldHint>Métadonnées officielles uniquement (titre, date, pochette) : les plateformes ne fournissent pas les paroles.</FieldHint>
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr_10rem]">
        {draft.coverUrl ? (
          <Image src={draft.coverUrl} alt="" width={64} height={64} className="size-16 rounded-xl object-cover" unoptimized />
        ) : (
          <div className="hidden size-16 rounded-xl bg-surface-2 sm:block" aria-hidden />
        )}
        <div>
          <Label htmlFor={id("title")}>{m.catalogue.trackTitle}</Label>
          <Input id={id("title")} required maxLength={200} value={draft.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={id("date")}>{m.catalogue.releaseDate}</Label>
          <Input
            id={id("date")}
            type="date"
            value={draft.releaseDate ?? ""}
            onChange={(e) => onChange({ releaseDate: e.target.value || null })}
          />
        </div>
      </div>
      <div>
        <div className="flex items-end justify-between gap-2">
          <Label htmlFor={id("lyrics")}>{m.catalogue.lyrics}</Label>
          <Button type="button" variant="link" size="sm" onClick={() => fileRef.current?.click()} disabled={loadingFile}>
            {loadingFile ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />} {m.catalogue.fromFile}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </div>
        <Textarea
          id={id("lyrics")}
          required
          rows={10}
          className="lyrics font-sans"
          placeholder={"[Couplet 1]\n…\n\n[Refrain]\n…"}
          value={draft.lyrics}
          onChange={(e) => onChange({ lyrics: e.target.value, source: draft.source })}
        />
        <FieldHint>{m.catalogue.lyricsHelp}</FieldHint>
        <LyricsStats lyrics={draft.lyrics} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={id("bpm")}>{m.catalogue.bpm}</Label>
          <Input
            id={id("bpm")}
            type="number"
            inputMode="decimal"
            min={40}
            max={250}
            value={draft.bpm ?? ""}
            onChange={(e) => onChange({ bpm: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:mt-6">
          <span className="text-sm">{m.catalogue.explicit}</span>
          <Switch checked={draft.explicit} onCheckedChange={(v) => onChange({ explicit: v })} aria-label={m.catalogue.explicit} />
        </label>
      </div>
    </Card>
  );
}

export function ImportTracksForm({
  remaining,
  onImported,
  submitLabel = "Importer",
}: {
  /** Tracks still allowed by the plan (-1 = unlimited). */
  remaining: number;
  onImported?: (count: number) => void;
  submitLabel?: string;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([empty(1)]);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const canAdd = remaining === -1 || drafts.length < remaining;

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!attested) return setError(m.catalogue.attestationRequired);
    start(async () => {
      const res = await importTracks(
        drafts.map(({ key: _key, ...t }) => ({ ...t, title: t.title.trim(), lyrics: t.lyrics.trim() })),
        attested,
      );
      if (!res?.ok) return setError(res?.message ?? m.common.error);
      toast(res.message, "success");
      setDrafts([empty(Date.now())]);
      setAttested(false);
      onImported?.(res.imported ?? 0);
    });
  }

  if (remaining === 0) {
    return <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">{m.catalogue.limitReached}</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {drafts.map((d, i) => (
        <TrackCard
          key={d.key}
          draft={d}
          index={i}
          onChange={(p) => update(d.key, p)}
          onRemove={drafts.length > 1 ? () => setDrafts((ds) => ds.filter((x) => x.key !== d.key)) : undefined}
        />
      ))}
      {canAdd && (
        <Button type="button" variant="outline" className="w-full" onClick={() => setDrafts((ds) => [...ds, empty(Date.now())])}>
          <Plus aria-hidden /> Ajouter un autre titre
        </Button>
      )}
      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <Checkbox checked={attested} onChange={(e) => setAttested(e.target.checked)} required />
        <span>
          <strong>{m.catalogue.attestation}</strong> Je n&apos;importe pas les paroles d&apos;un autre artiste. Cette attestation est horodatée.
        </span>
      </label>
      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m.common.saving : submitLabel}
      </Button>
    </form>
  );
}
