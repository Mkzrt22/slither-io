"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { contentToTextSafe, humanEditRatio } from "@/lib/text/versions";
import type { LyricContent, LyricVersionRow, ProjectRow } from "@/lib/db/types";

const SECTION = z.object({
  type: z.enum(["intro", "couplet", "pre_refrain", "refrain", "pont", "outro"]),
  label: z.string().trim().min(1).max(40),
  bars: z.number().int().min(0).max(64),
  flow: z.object({ pace: z.enum(["lent", "moyen", "rapide", "variable"]), notes: z.string().max(300) }).optional(),
  lines: z.array(z.string().max(300)).max(64),
});
const CONTENT = z.object({ sections: z.array(SECTION).max(20), angle: z.string().max(300).optional() });

export async function createProject(input: { title?: string; theme?: string; mood?: string; bpm?: number | null; musicalKey?: string | null }) {
  await requireUser();
  const artist = await getActiveArtist();
  if (!artist) return { ok: false as const, message: "Crée d'abord ton profil artiste." };
  const d = z
    .object({
      title: z.string().trim().max(200).optional(),
      theme: z.string().trim().max(500).optional(),
      mood: z.string().trim().max(60).optional(),
      bpm: z.number().min(40).max(250).nullable().optional(),
      musicalKey: z.string().trim().max(12).nullable().optional(),
    })
    .parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      artist_id: artist.id,
      title: d.title || (d.theme ? d.theme.slice(0, 60) : "Sans titre"),
      theme: d.theme ?? null,
      mood: d.mood ?? null,
      bpm: d.bpm ?? null,
      musical_key: d.musicalKey ?? null,
      status: "idea",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const, message: "Création du projet impossible." };
  revalidatePath("/app/projets");
  return { ok: true as const, id: (data as { id: string }).id };
}

export async function updateProjectMeta(
  id: string,
  patch: { title?: string; status?: ProjectRow["status"]; notes?: string; bpm?: number | null; musical_key?: string | null },
) {
  await requireUser();
  const d = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      status: z.enum(["idea", "writing", "ready", "released"]).optional(),
      notes: z.string().max(10000).optional(),
      bpm: z.number().min(40).max(250).nullable().optional(),
      musical_key: z.string().trim().max(12).nullable().optional(),
    })
    .parse(patch);
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(d).eq("id", z.string().uuid().parse(id));
  if (error) return { ok: false, message: "Enregistrement impossible." };
  revalidatePath("/app/projets");
  return { ok: true, message: "Enregistré" };
}

export async function deleteProject(formData: FormData): Promise<void> {
  await requireUser();
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", id);
  revalidatePath("/app/projets");
  redirect("/app/projets");
}

/** Nearest AI-generated ancestor (to measure the artist's own contribution). */
async function aiAncestor(versionId: string | null): Promise<LyricVersionRow | null> {
  const supabase = await createClient();
  let id = versionId;
  for (let i = 0; id && i < 20; i++) {
    const { data } = await supabase.from("lyric_versions").select("*").eq("id", id).maybeSingle();
    const v = data as LyricVersionRow | null;
    if (!v) return null;
    if (v.is_ai_generated && v.variant !== "edit") return v;
    id = v.parent_version_id;
  }
  return null;
}

/**
 * Autosave of the working copy (variant "edit"). The project's current
 * version points to it; human_edit_ratio = share of lines rewritten by the
 * artist compared with the AI proposal it started from.
 */
export async function saveWorkingCopy(projectId: string, content: LyricContent, parentVersionId?: string | null) {
  await requireUser();
  const pid = z.string().uuid().parse(projectId);
  const parsed = CONTENT.safeParse(content);
  if (!parsed.success) return { ok: false as const, message: "Contenu invalide" };
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, current_version_id").eq("id", pid).maybeSingle();
  if (!project) return { ok: false as const, message: "Projet introuvable" };
  const current = (project as Pick<ProjectRow, "current_version_id">).current_version_id;

  let currentRow: LyricVersionRow | null = null;
  if (current) {
    const { data } = await supabase.from("lyric_versions").select("*").eq("id", current).maybeSingle();
    currentRow = data as LyricVersionRow | null;
  }
  const parent = parentVersionId ?? (currentRow?.variant === "edit" ? currentRow.parent_version_id : current);
  const ancestor = await aiAncestor(parent ?? null);
  const ratio = ancestor ? humanEditRatio(ancestor.content_json, parsed.data) : 1;
  const text = contentToTextSafe(parsed.data);

  if (currentRow && currentRow.variant === "edit" && !parentVersionId) {
    const { error } = await supabase
      .from("lyric_versions")
      .update({ content_json: parsed.data, content_text: text, human_edit_ratio: ratio })
      .eq("id", currentRow.id);
    if (error) return { ok: false as const, message: "Sauvegarde impossible" };
    return { ok: true as const, versionId: currentRow.id, ratio };
  }
  const { data: inserted, error } = await supabase
    .from("lyric_versions")
    .insert({
      project_id: pid,
      parent_version_id: parent ?? null,
      variant: "edit",
      label: "Copie de travail",
      title: ancestor?.title ?? null,
      content_json: parsed.data,
      content_text: text,
      is_ai_generated: Boolean(ancestor),
      human_edit_ratio: ratio,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false as const, message: "Sauvegarde impossible" };
  const versionId = (inserted as { id: string }).id;
  await supabase.from("projects").update({ current_version_id: versionId, status: "writing" }).eq("id", pid);
  return { ok: true as const, versionId, ratio };
}

/** Starts a working copy from a proposal (A/B/C) or an older version. */
export async function startFromVersion(projectId: string, versionId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("lyric_versions").select("*").eq("id", z.string().uuid().parse(versionId)).maybeSingle();
  const v = data as LyricVersionRow | null;
  if (!v || v.project_id !== projectId) return { ok: false as const, message: "Version introuvable" };
  const res = await saveWorkingCopy(projectId, v.content_json, v.id);
  revalidatePath(`/app/studio/${projectId}`);
  return res;
}

/** Freezes the current working copy as a named version (history). */
export async function snapshotVersion(projectId: string, label: string) {
  await requireUser();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("current_version_id").eq("id", projectId).maybeSingle();
  const current = (project as Pick<ProjectRow, "current_version_id"> | null)?.current_version_id;
  if (!current) return { ok: false, message: "Rien à enregistrer" };
  const { data } = await supabase.from("lyric_versions").select("*").eq("id", current).maybeSingle();
  const v = data as LyricVersionRow | null;
  if (!v) return { ok: false, message: "Version introuvable" };
  const { error } = await supabase.from("lyric_versions").insert({
    project_id: projectId,
    parent_version_id: v.id,
    variant: "edit",
    label: z.string().trim().min(1).max(80).catch("Version").parse(label),
    title: v.title,
    content_json: v.content_json,
    content_text: v.content_text,
    is_ai_generated: v.is_ai_generated,
    human_edit_ratio: v.human_edit_ratio,
  });
  revalidatePath(`/app/studio/${projectId}`);
  return error ? { ok: false, message: "Enregistrement impossible" } : { ok: true, message: "Version enregistrée" };
}

/** Private share link (token generated server-side; only get_shared_project() can read it). */
export async function setShare(projectId: string, enabled: boolean) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, owner_id, current_version_id").eq("id", projectId).maybeSingle();
  const p = project as Pick<ProjectRow, "id" | "owner_id" | "current_version_id"> | null;
  if (!p || p.owner_id !== user.id) return { ok: false as const, message: "Projet introuvable" };
  if (enabled && !p.current_version_id) return { ok: false as const, message: "Choisis d'abord une version à partager." };
  const token = enabled ? randomBytes(18).toString("base64url") : null;
  await createAdminClient()
    .from("projects")
    .update({ share_token: token, shared_at: enabled ? new Date().toISOString() : null } as never)
    .eq("id", p.id)
    .eq("owner_id", user.id);
  revalidatePath(`/app/studio/${projectId}`);
  return { ok: true as const, token };
}

export async function reportContent(versionId: string, reason: string) {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("lyric_versions").select("id, generation_id, content_text").eq("id", versionId).maybeSingle();
  const v = data as Pick<LyricVersionRow, "id" | "generation_id" | "content_text"> | null;
  if (!v) return { ok: false, message: "Version introuvable" };
  const { error } = await supabase.from("moderation_flags").insert({
    lyric_version_id: v.id,
    generation_id: v.generation_id,
    source: "user_report",
    category: "user_report",
    reason: reason.slice(0, 2000),
    excerpt: v.content_text.slice(0, 1000),
  });
  return error ? { ok: false, message: "Signalement impossible" } : { ok: true, message: "Merci, notre équipe va examiner ce contenu." };
}
