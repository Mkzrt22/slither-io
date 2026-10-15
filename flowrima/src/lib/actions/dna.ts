"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { consumeQuota } from "@/lib/services/usage";
import { inngest, EVENTS, queueConfigured } from "@/lib/jobs/client";
import { runDnaInline } from "@/lib/jobs/dna-job";
import { rateLimit } from "@/lib/ratelimit";

export type DnaActionState = { ok: boolean; message: string; jobId?: string } | null;

/** Queues a DNA analysis (Inngest) — or runs it in the background without a queue (local dev). */
export async function requestDnaAnalysis(): Promise<DnaActionState> {
  const user = await requireUser();
  const artist = await getActiveArtist();
  if (!artist) return { ok: false, message: "Crée d'abord ton profil artiste." };
  if (!(await rateLimit(`user:${user.id}:dna`, 3, 600))) return { ok: false, message: "Patiente quelques minutes avant de relancer." };

  const supabase = await createClient();
  const { count } = await supabase
    .from("tracks")
    .select("id", { count: "exact", head: true })
    .eq("artist_id", artist.id)
    .not("lyrics", "is", null);
  if (!count) return { ok: false, message: "Importe au moins un titre avec ses paroles." };

  const admin = createAdminClient();
  const { data: running } = await admin
    .from("jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "dna_analysis")
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .maybeSingle();
  if (running) return { ok: true, message: "Analyse déjà en cours", jobId: (running as { id: string }).id };

  const quota = await consumeQuota(user.id, "dna_analysis", artist.id);
  if (!quota.allowed) return { ok: false, message: "Tu as atteint le nombre d'analyses ADN de ton plan ce mois-ci." };

  const { data: job, error } = await admin
    .from("jobs")
    .insert({ user_id: user.id, type: "dna_analysis", status: "queued", progress: 0, message: "En file d'attente…" } as never)
    .select("id")
    .single();
  if (error || !job) return { ok: false, message: "Impossible de lancer l'analyse." };
  const jobId = (job as { id: string }).id;
  const data = { userId: user.id, artistId: artist.id, jobId, usageEventId: quota.event_id };

  if (queueConfigured()) {
    await inngest.send({ name: EVENTS.dnaRequested, data });
  } else {
    after(() => runDnaInline(data));
  }
  await admin.from("profiles").update({ onboarding_step: 3 } as never).eq("id", user.id).lt("onboarding_step", 3);
  revalidatePath("/app/adn");
  return { ok: true, message: "Analyse lancée", jobId };
}
