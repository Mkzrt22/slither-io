"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { detectPlatform } from "@/lib/platforms/metadata";

export type ActionState = { ok: boolean; message: string; id?: string } | null;

const LINK_PLATFORMS = ["spotify", "deezer", "youtube", "instagram", "soundcloud"] as const;

const profileSchema = z.object({
  stageName: z.string().trim().min(1, "Nom de scène requis").max(80),
  genres: z.array(z.string().max(30)).max(5),
  languages: z.array(z.string().max(10)).min(1, "Choisis au moins une langue").max(5),
  explicit: z.boolean(),
  links: z.record(z.enum(LINK_PLATFORMS), z.string().trim().max(300).optional()),
});

function platformOf(key: (typeof LINK_PLATFORMS)[number], url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  if (key === "instagram") return /^https:\/\/(www\.)?instagram\.com\//i.test(url);
  return detectPlatform(url)?.platform === key;
}

/** Creates or updates the artist profile + platform links (onboarding step 1). */
export async function saveArtistProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    stageName: formData.get("stageName"),
    genres: formData.getAll("genres").map(String),
    languages: formData.getAll("languages").map(String),
    explicit: formData.get("explicit") === "on",
    links: Object.fromEntries(LINK_PLATFORMS.map((p) => [p, (formData.get(`link_${p}`) as string | null) || undefined])),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data;
  for (const [k, v] of Object.entries(d.links)) {
    if (v && !platformOf(k as (typeof LINK_PLATFORMS)[number], v)) return { ok: false, message: `Lien ${k} invalide.` };
  }

  const supabase = await createClient();
  const existing = await getActiveArtist();
  let artistId = existing?.id;
  const fields = { stage_name: d.stageName, genres: d.genres, languages: d.languages, explicit_default: d.explicit };
  if (artistId) {
    const { error } = await supabase.from("artist_profiles").update(fields).eq("id", artistId);
    if (error) return { ok: false, message: "Enregistrement impossible." };
  } else {
    const { data, error } = await supabase.from("artist_profiles").insert(fields).select("id").single();
    if (error) return { ok: false, message: error.message.includes("quota_exceeded") ? "Limite de profils artistes atteinte." : "Enregistrement impossible." };
    artistId = (data as { id: string }).id;
  }

  // Replace links
  await supabase.from("platform_links").delete().eq("artist_id", artistId);
  const links = Object.entries(d.links)
    .filter(([, v]) => v)
    .map(([platform, url]) => ({ artist_id: artistId!, platform, url: url! }));
  if (links.length) await supabase.from("platform_links").insert(links);

  await supabase.from("profiles").update({ onboarding_step: 1 }).eq("id", user.id).lt("onboarding_step", 1);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profil enregistré", id: artistId };
}

/**
 * « Artiste vérifié » : generates a code to place in the Instagram bio; an
 * admin then checks it manually (status pending -> verified).
 */
export async function requestVerification(): Promise<ActionState> {
  const user = await requireUser();
  const artist = await getActiveArtist();
  if (!artist) return { ok: false, message: "Crée d'abord ton profil artiste." };
  const code = `FLOW-${randomBytes(3).toString("hex").toUpperCase()}`;
  // verification_* columns are server-only: written with the service role after the ownership check above
  await createAdminClient()
    .from("artist_profiles")
    .update({ verification_code: code, verification_status: "pending" } as never)
    .eq("id", artist.id)
    .eq("owner_id", user.id);
  revalidatePath("/app/compte");
  return { ok: true, message: code };
}
