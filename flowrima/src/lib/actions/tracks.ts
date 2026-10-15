"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { CONSENT_VERSIONS, consentMeta } from "@/lib/consents";
import { m } from "@/i18n";
import { LIMITS, rateLimit } from "@/lib/ratelimit";
import { detectPlatform } from "@/lib/platforms/metadata";

export type ImportState = { ok: boolean; message: string; imported?: number } | null;

const trackSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(200),
  lyrics: z.string().trim().min(20, "Paroles trop courtes").max(20000, "Paroles trop longues (20 000 caractères max.)"),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  link: z.string().trim().max(500).nullable(),
  coverUrl: z.string().url().max(500).nullable(),
  durationSeconds: z.number().int().min(1).max(7200).nullable(),
  bpm: z.number().min(40).max(250).nullable(),
  explicit: z.boolean(),
  source: z.enum(["paste", "file"]),
});
export type TrackInput = z.infer<typeof trackSchema>;

/**
 * Imports one or more tracks. The rights attestation is mandatory and logged
 * (consents register + tracks.rights_attested_at).
 */
export async function importTracks(tracks: TrackInput[], attested: boolean): Promise<ImportState> {
  const user = await requireUser();
  if (!attested) return { ok: false, message: m.catalogue.attestationRequired };
  if (!(await rateLimit(`user:${user.id}:import`, LIMITS.import.limit, LIMITS.import.window))) {
    return { ok: false, message: "Trop d'imports d'un coup, patiente une minute." };
  }
  const artist = await getActiveArtist();
  if (!artist) return { ok: false, message: "Crée d'abord ton profil artiste." };
  const parsed = z.array(trackSchema).min(1).max(20).safeParse(tracks);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Données invalides" };

  const now = new Date().toISOString();
  const rows = parsed.data.map((t) => {
    const platform = t.link ? detectPlatform(t.link)?.platform : undefined;
    return {
      artist_id: artist.id,
      title: t.title,
      lyrics: t.lyrics,
      release_date: t.releaseDate,
      links: platform && t.link ? { [platform]: t.link } : {},
      cover_url: t.coverUrl,
      duration_seconds: t.durationSeconds,
      bpm_manual: t.bpm,
      is_explicit: t.explicit,
      lyrics_source: t.source,
      rights_attested_at: now,
    };
  });

  const supabase = await createClient();
  const { data, error } = await supabase.from("tracks").insert(rows).select("id");
  if (error) {
    if (error.message.includes("quota_exceeded")) return { ok: false, message: m.catalogue.limitReached };
    return { ok: false, message: "Import impossible pour le moment." };
  }
  const ids = ((data as Array<{ id: string }>) ?? []).map((r) => r.id);
  await supabase.from("consents").insert({
    kind: "rights_attestation",
    granted: true,
    version: CONSENT_VERSIONS.rights_attestation,
    subject_type: "track",
    subject_ids: ids,
    text_snapshot: m.catalogue.attestation,
    ...consentMeta(await headers()),
  });
  await supabase.from("profiles").update({ onboarding_step: 2 }).eq("id", user.id).lt("onboarding_step", 2);
  revalidatePath("/app", "layout");
  return { ok: true, message: `${ids.length} titre(s) importé(s)`, imported: ids.length };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  lyrics: z.string().trim().min(20).max(20000),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  bpm: z.number().min(40).max(250).nullable(),
  explicit: z.boolean(),
});

export async function updateTrack(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireUser();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    lyrics: formData.get("lyrics"),
    releaseDate: (formData.get("releaseDate") as string) || null,
    bpm: formData.get("bpm") ? Number(formData.get("bpm")) : null,
    explicit: formData.get("explicit") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("tracks")
    .update({ title: d.title, lyrics: d.lyrics, release_date: d.releaseDate, bpm_manual: d.bpm, is_explicit: d.explicit })
    .eq("id", d.id);
  if (error) return { ok: false, message: "Enregistrement impossible." };
  revalidatePath(`/app/catalogue/${d.id}`);
  revalidatePath("/app/catalogue");
  return { ok: true, message: "Titre mis à jour. Pense à mettre à jour ton ADN." };
}

export async function deleteTrack(formData: FormData): Promise<void> {
  await requireUser();
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("tracks").delete().eq("id", id);
  revalidatePath("/app", "layout");
  redirect("/app/catalogue");
}
