"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/actions/projects";
import { m } from "@/i18n";
import { ParamsPanel, type GenerationParams, type StudioDefaults } from "./params-panel";
import { GenerationView } from "./generation-view";
import { UpgradeDialog } from "./upgrade-dialog";
import { useGeneration } from "./use-generation";

/** New song: parameters -> project creation -> live generation -> project page. */
export function NewSongStudio({
  defaults,
  initialSubject,
  quotaLeft,
}: {
  defaults: StudioDefaults;
  initialSubject?: string;
  quotaLeft: number | null;
}) {
  const router = useRouter();
  const gen = useGeneration();
  const [creating, setCreating] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(quotaLeft === 0);

  async function onSubmit(params: GenerationParams) {
    setError(null);
    if (quotaLeft === 0) return setUpgrade(true);
    setCreating(true);
    let id = projectId;
    if (!id) {
      const res = await createProject({
        title: params.workingTitle,
        theme: params.subject,
        mood: params.mood,
        bpm: params.bpm ?? null,
        musicalKey: params.musicalKey ?? null,
      });
      if (!res.ok) {
        setCreating(false);
        return setError(res.message);
      }
      id = res.id;
      setProjectId(id);
    }
    setCreating(false);
    const done = await gen.run(id, params);
    if (done) router.push(`/app/studio/${id}`);
  }

  const running = creating || (gen.status !== "idle" && gen.status !== "error" && gen.status !== "done");
  return (
    <div className="space-y-4">
      {running || gen.status === "done" ? (
        <GenerationView status={gen.status === "idle" ? "thinking" : gen.status} partial={gen.partial} startedAt={gen.startedAt} onCancel={gen.cancel} />
      ) : (
        <>
          {gen.status === "error" && gen.error && (
            <Card className="border-danger/40">
              <p role="alert" className="text-danger">{gen.error.message}</p>
              {gen.error.code === "quota_exceeded" && (
                <Button className="mt-3" onClick={() => setUpgrade(true)}>{m.common.upgrade}</Button>
              )}
            </Card>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <ParamsPanel
            defaults={defaults}
            initial={initialSubject ? { subject: initialSubject } : undefined}
            submitting={running}
            onSubmit={onSubmit}
            quotaLeft={quotaLeft}
          />
        </>
      )}
      <UpgradeDialog open={upgrade} onOpenChange={setUpgrade} detail={m.studio.quotaReached} />
    </div>
  );
}
