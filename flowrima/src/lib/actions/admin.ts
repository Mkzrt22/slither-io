"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

/** Every admin action: role check + service role + audit log. */
async function audit(actor: string, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await createAdminClient().rpc("log_audit", {
    p_actor: actor, p_action: action, p_target_type: targetType, p_target_id: targetId, p_metadata: metadata,
  } as never);
}

const LimitsSchema = z.object({
  tracks_max: z.number().int().min(-1),
  lyrics_generations: z.number().int().min(-1),
  retouches: z.number().int().min(-1),
  assists: z.number().int().min(-1),
  dna_analyses: z.number().int().min(-1),
  pdf_exports: z.number().int().min(-1),
  prod_credits_monthly: z.number().int().min(0),
  prod_generations: z.number().int().min(-1),
  artist_profiles_max: z.number().int().min(1),
  pdf_export: z.boolean(),
  prod_ai: z.boolean(),
  stems: z.boolean(),
  history_days: z.number().int().min(-1),
  priority: z.boolean(),
});

export async function updatePlanLimits(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const admin = await requireAdmin();
  const id = z.enum(["free", "artist", "pro", "label"]).parse(formData.get("id"));
  let parsed;
  try {
    parsed = LimitsSchema.safeParse(JSON.parse(String(formData.get("limits"))));
  } catch {
    return { ok: false, message: "JSON invalide" };
  }
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" · ") };
  const { error } = await createAdminClient().from("plans").update({ limits: parsed.data } as never).eq("id", id);
  if (error) return { ok: false, message: error.message };
  await audit(admin.id, "plan.limits_updated", "plan", id, parsed.data);
  revalidateTag("plans", "max");
  revalidatePath("/app/admin/plans");
  return { ok: true, message: `Quotas du plan ${id} mis à jour` };
}

export async function reviewFlag(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(["dismissed", "actioned"]).parse(formData.get("status"));
  await createAdminClient()
    .from("moderation_flags")
    .update({ status, reviewed_by: admin.id, reviewed_at: new Date().toISOString() } as never)
    .eq("id", id);
  await audit(admin.id, `moderation.${status}`, "moderation_flag", id);
  revalidatePath("/app/admin/moderation");
}

export async function setUserRole(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  const role = z.enum(["user", "admin"]).parse(formData.get("role"));
  if (id === admin.id && role === "user") return; // never lock yourself out
  await createAdminClient().from("profiles").update({ role } as never).eq("id", id);
  await audit(admin.id, "user.role_changed", "user", id, { role });
  revalidatePath("/app/admin/utilisateurs");
}

export async function reviewVerification(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  const decision = z.enum(["verified", "rejected"]).parse(formData.get("decision"));
  await createAdminClient()
    .from("artist_profiles")
    .update({ verification_status: decision, verified_at: decision === "verified" ? new Date().toISOString() : null } as never)
    .eq("id", id);
  await audit(admin.id, `artist.${decision}`, "artist_profile", id);
  revalidatePath("/app/admin/utilisateurs");
}
