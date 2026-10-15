"use client";
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Copy, Download, FileText, Flag, History, Link2, NotebookPen, PenLine, Save, Sparkles, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { LyricsView } from "@/components/lyrics/lyrics-view";
import {
  reportContent, setShare, snapshotVersion, startFromVersion, updateProjectMeta,
} from "@/lib/actions/projects";
import type { LyricContent, LyricVersionRow, ProjectRow } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";
import { fmt, m } from "@/i18n";
import { LyricsEditor } from "./lyrics-editor";
import { ParamsPanel, type GenerationParams, type StudioDefaults } from "./params-panel";
import { GenerationView } from "./generation-view";
import { UpgradeDialog } from "./upgrade-dialog";
import { useGeneration } from "./use-generation";

export interface ProjectStudioProps {
  project: ProjectRow;
  versions: LyricVersionRow[];
  defaults: StudioDefaults;
  lastParams: Partial<GenerationParams> | null;
  quotaLeft: number | null;
  pdfAllowed: boolean;
  siteUrl: string;
  autoGenerate?: boolean;
}

function ProposalCard({ v, onUse, busy }: { v: LyricVersionRow; onUse: () => void; busy: boolean }) {
  const report = v.recycling_report as { fixed?: number; removed?: number } | null;
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">{v.label ?? v.variant}</p>
        <h3 className="text-lg font-semibold">{v.title}</h3>
        {v.content_json.angle && <p className="text-sm text-muted">{v.content_json.angle}</p>}
      </div>
      <LyricsView sections={v.content_json.sections} />
      {v.why_json && v.why_json.length > 0 && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-1 font-semibold">{m.studio.why}</p>
          <ul className="list-disc space-y-1 pl-4">
            {v.why_json.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {report && (report.fixed ?? 0) + (report.removed ?? 0) > 0 && (
        <p className="text-xs text-muted">
          {fmt(m.studio.recyclingFixed, { n: (report.fixed ?? 0) + (report.removed ?? 0) })}
          {(report.removed ?? 0) > 0 && ` ${m.studio.removedLine}`}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Badge>
          <Sparkles className="size-3" aria-hidden /> {m.common.aiGenerated}
        </Badge>
        <Button size="sm" onClick={onUse} disabled={busy}>
          <PenLine aria-hidden /> {m.studio.choose}
        </Button>
      </div>
    </Card>
  );
}

export function ProjectStudio(props: ProjectStudioProps) {
  const { project } = props;
  const router = useRouter();
  const toast = useToast();
  const gen = useGeneration();
  const [pending, start] = useTransition();
  const working = props.versions.find((v) => v.id === project.current_version_id && v.variant === "edit") ?? null;
  const latestGenerationId = props.versions.find((v) => v.variant !== "edit")?.generation_id;
  const proposals = props.versions
    .filter((v) => v.variant !== "edit" && v.generation_id === latestGenerationId)
    .sort((a, b) => a.variant.localeCompare(b.variant));
  const [tab, setTab] = useState(working ? "editor" : "proposals");
  const [paramsOpen, setParamsOpen] = useState(!proposals.length && !working);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(project.share_token);
  const [editorContent, setEditorContent] = useState<{ key: string; content: LyricContent } | null>(
    working ? { key: working.id, content: working.content_json } : null,
  );
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(working?.id ?? null);
  const [ratio, setRatio] = useState<number>(Number(working?.human_edit_ratio ?? 0));

  const liveContent = useRef<LyricContent | null>(working?.content_json ?? null);
  const onChange = useCallback((c: LyricContent) => {
    liveContent.current = c;
  }, []);
  const onQuota = setUpgrade; // state setters are stable
  const onSaved = useCallback((id: string, r: number) => {
    setCurrentVersionId(id);
    setRatio(r);
  }, []);

  async function generate(params: GenerationParams) {
    setParamsOpen(false);
    setTab("proposals");
    const done = await gen.run(project.id, params);
    if (done) {
      toast("3 propositions prêtes", "success");
      router.refresh();
    }
  }

  function use(v: LyricVersionRow) {
    start(async () => {
      const res = await startFromVersion(project.id, v.id);
      if (!res.ok) return toast(res.message ?? m.common.error, "error");
      setEditorContent({ key: res.versionId, content: v.content_json });
      setCurrentVersionId(res.versionId);
      setTab("editor");
      router.refresh();
    });
  }

  const exportHref = (format: "txt" | "pdf") => (currentVersionId ? `/api/export/${currentVersionId}?format=${format}` : undefined);
  const shareUrl = shareToken ? `${props.siteUrl}/s/${shareToken}` : null;
  const generating = gen.status !== "idle" && gen.status !== "done" && gen.status !== "error";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          aria-label="Titre du morceau"
          defaultValue={project.title}
          className="h-12 flex-1 border-transparent bg-transparent px-0 text-2xl font-bold hover:border-border focus:px-3"
          onBlur={(e) => e.target.value.trim() && e.target.value !== project.title && updateProjectMeta(project.id, { title: e.target.value.trim() })}
        />
        <Select
          aria-label="Statut du projet"
          className="sm:w-48"
          defaultValue={project.status}
          onChange={(e) => updateProjectMeta(project.id, { status: e.target.value as ProjectRow["status"] })}
        >
          {(["idea", "writing", "ready", "released"] as const).map((s) => (
            <option key={s} value={s}>{m.projects.status[s]}</option>
          ))}
        </Select>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setParamsOpen(true)} disabled={generating}>
          <Wand2 aria-hidden /> {proposals.length ? "Nouvelles propositions" : m.studio.generate}
        </Button>
        {currentVersionId && (
          <>
            <Button variant="outline" asChild>
              <a href={exportHref("txt")} download><FileText aria-hidden /> TXT</a>
            </Button>
            {props.pdfAllowed ? (
              <Button variant="outline" asChild>
                <a href={exportHref("pdf")} download><Download aria-hidden /> {m.studio.exportPdf}</a>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setUpgrade("L'export PDF « fiche studio » est inclus dans le plan Artiste.")}>
                <Download aria-hidden /> PDF
              </Button>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                const text = (liveContent.current?.sections ?? []).map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n");
                await navigator.clipboard.writeText(text).catch(() => {});
                toast(m.common.copied);
              }}
            >
              <Copy aria-hidden /> {m.common.copy}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                start(async () => {
                  const res = await setShare(project.id, !shareToken);
                  if (!res.ok) return toast(res.message ?? m.common.error, "error");
                  setShareToken(res.token ?? null);
                  if (res.token) {
                    await navigator.clipboard.writeText(`${props.siteUrl}/s/${res.token}`).catch(() => {});
                    toast("Lien privé copié");
                  }
                })
              }
            >
              <Link2 aria-hidden /> {shareToken ? m.studio.shareRevoke : m.studio.share}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const label = prompt("Nom de la version", `Version du ${formatDate(new Date().toISOString())}`);
                if (label) start(async () => toast((await snapshotVersion(project.id, label)).message));
              }}
            >
              <Save aria-hidden /> {m.studio.saveVersion}
            </Button>
          </>
        )}
      </div>
      {shareUrl && (
        <p className="break-all rounded-xl bg-surface-2 p-3 text-sm">
          Lien privé : <a href={shareUrl} className="text-accent-text underline" target="_blank" rel="noreferrer">{shareUrl}</a>
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="proposals"><Sparkles className="mr-1 inline size-4" aria-hidden />Propositions</TabsTrigger>
          <TabsTrigger value="editor"><PenLine className="mr-1 inline size-4" aria-hidden />{m.studio.editor}</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1 inline size-4" aria-hidden />Historique</TabsTrigger>
          <TabsTrigger value="notes"><NotebookPen className="mr-1 inline size-4" aria-hidden />Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="proposals" className="mt-4">
          {generating ? (
            <GenerationView status={gen.status} partial={gen.partial} startedAt={gen.startedAt} onCancel={gen.cancel} />
          ) : gen.status === "error" && gen.error ? (
            <Card className="space-y-3 border-danger/40">
              <p role="alert" className="text-danger">{gen.error.message}</p>
              {gen.error.code === "quota_exceeded" ? (
                <Button onClick={() => setUpgrade(gen.error!.message)}>{m.common.upgrade}</Button>
              ) : (
                <Button variant="outline" onClick={() => setParamsOpen(true)}>{m.common.retry}</Button>
              )}
            </Card>
          ) : proposals.length ? (
            <>
              <div className="hidden gap-4 lg:grid lg:grid-cols-3">
                {proposals.map((v) => (
                  <ProposalCard key={v.id} v={v} onUse={() => use(v)} busy={pending} />
                ))}
              </div>
              <Tabs defaultValue={proposals[0].id} className="lg:hidden">
                <TabsList>
                  {proposals.map((v) => (
                    <TabsTrigger key={v.id} value={v.id}>{m.studio.variants[v.variant as "A" | "B" | "C"] ?? v.variant}</TabsTrigger>
                  ))}
                </TabsList>
                {proposals.map((v) => (
                  <TabsContent key={v.id} value={v.id} className="mt-3">
                    <ProposalCard v={v} onUse={() => use(v)} busy={pending} />
                  </TabsContent>
                ))}
              </Tabs>
            </>
          ) : (
            <EmptyState
              title="Aucune proposition pour l'instant"
              description="Décris ton sujet et ta structure : l'IA écrit 3 versions dans ton style."
              action={<Button onClick={() => setParamsOpen(true)}><Wand2 aria-hidden /> {m.studio.generate}</Button>}
            />
          )}
        </TabsContent>

        <TabsContent value="editor" className="mt-4">
          {editorContent ? (
            <>
              <p className="mb-3 rounded-xl border border-border p-3 text-xs text-muted">
                {m.studio.sacemNotice} Réécrit par toi : <strong className="text-foreground">{Math.round(ratio * 100)} %</strong>.
              </p>
              <LyricsEditor
                key={editorContent.key}
                projectId={project.id}
                initial={editorContent.content}
                bpm={project.bpm}
                genre={props.defaults.genre}
                artistSyllables={props.defaults.artistSyllables}
                explicit={props.defaults.explicit}
                onQuota={onQuota}
                onSaved={onSaved}
                onChange={onChange}
              />
              {currentVersionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-6 text-muted"
                  onClick={() => {
                    const reason = prompt("Pourquoi signales-tu ce contenu ?");
                    if (reason) start(async () => toast((await reportContent(currentVersionId, reason)).message));
                  }}
                >
                  <Flag aria-hidden /> Signaler un contenu problématique
                </Button>
              )}
            </>
          ) : (
            <EmptyState title="Choisis une proposition" description="Clique sur « Travailler cette version » pour l'éditer ligne par ligne." />
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <ul className="space-y-2">
            {props.versions.map((v) => (
              <li key={v.id}>
                <details className="rounded-2xl border border-border bg-surface p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{v.label ?? v.variant} {v.title ? `— ${v.title}` : ""}</span>
                    <span className="text-xs text-muted">
                      {formatDate(v.created_at)}
                      {v.variant === "edit" && ` · réécrit à ${Math.round(Number(v.human_edit_ratio) * 100)} %`}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <LyricsView sections={v.content_json.sections} showFlow={false} />
                    <Button size="sm" variant="outline" onClick={() => use(v)} disabled={pending}>Repartir de cette version</Button>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <Textarea
            aria-label={m.projects.notes}
            rows={10}
            defaultValue={project.notes ?? ""}
            placeholder="Idées de clip, placement des ad-libs, featurings, références de prod…"
            onBlur={(e) => updateProjectMeta(project.id, { notes: e.target.value }).then(() => toast(m.common.saved))}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={paramsOpen} onOpenChange={setParamsOpen}>
        <DialogContent title={m.studio.newSong} description="Sujet, ambiance, structure : l'IA écrit 3 propositions." className="sm:max-w-2xl">
          <ParamsPanel
            defaults={props.defaults}
            initial={props.lastParams ?? { subject: project.theme ?? undefined, mood: project.mood ?? undefined, bpm: project.bpm }}
            submitting={generating}
            onSubmit={generate}
            quotaLeft={props.quotaLeft}
          />
        </DialogContent>
      </Dialog>
      <UpgradeDialog open={!!upgrade} onOpenChange={(o) => !o && setUpgrade(null)} detail={upgrade ?? undefined} />
    </div>
  );
}
