"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { CONSENT_VERSIONS, consentMeta } from "@/lib/consents";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { ipHash } from "@/lib/ratelimit";
import type { SubscriptionRow } from "@/lib/db/types";

export type AccountState = { ok: boolean; message: string } | null;

export async function updateDisplayName(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser();
  const name = z.string().trim().min(1).max(80).safeParse(formData.get("displayName"));
  if (!name.success) return { ok: false, message: "Nom invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: name.data }).eq("id", user.id);
  revalidatePath("/app", "layout");
  return error ? { ok: false, message: "Enregistrement impossible" } : { ok: true, message: "Enregistré" };
}

/** Opt-ins (training / marketing): profile flag + entry in the consents register. */
export async function setOptin(kind: "training_optin" | "marketing_optin", granted: boolean): Promise<AccountState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ [kind]: Boolean(granted) }).eq("id", user.id);
  if (error) return { ok: false, message: "Enregistrement impossible" };
  await supabase.from("consents").insert({
    kind,
    granted: Boolean(granted),
    version: CONSENT_VERSIONS[kind],
    ...consentMeta(await headers()),
  });
  revalidatePath("/app/compte");
  return { ok: true, message: granted ? "Activé" : "Désactivé" };
}

export async function updatePassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  await requireUser();
  const pwd = z.string().min(8, "8 caractères minimum").max(200).safeParse(formData.get("password"));
  if (!pwd.success) return { ok: false, message: pwd.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pwd.data });
  return error ? { ok: false, message: "Mise à jour impossible (reconnecte-toi puis réessaie)." } : { ok: true, message: "Mot de passe mis à jour" };
}

/**
 * RGPD — deletion in one click (with typed confirmation): cancels Stripe
 * subscriptions, removes stored files, deletes the auth user (cascades to
 * every table). Invoices stay at Stripe (legal retention).
 */
export async function deleteAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser();
  if (String(formData.get("confirm")).trim().toUpperCase() !== "SUPPRIMER") {
    return { ok: false, message: "Tape SUPPRIMER pour confirmer." };
  }
  const admin = createAdminClient();
  const { data: subs } = await admin.from("subscriptions").select("*").eq("user_id", user.id);
  if (stripeConfigured()) {
    for (const s of (subs as SubscriptionRow[] | null) ?? []) {
      if (["trialing", "active", "past_due", "unpaid"].includes(s.status)) {
        await getStripe().subscriptions.cancel(s.stripe_subscription_id).catch(() => {});
      }
    }
  }
  for (const bucket of ["audio", "avatars"]) {
    const { data: files } = await admin.storage.from(bucket).list(user.id, { limit: 1000 }).catch(() => ({ data: null }));
    if (files?.length) await admin.storage.from(bucket).remove(files.map((f) => `${user.id}/${f.name}`)).catch(() => {});
  }
  await admin.rpc("log_audit", {
    p_actor: null, p_action: "account.deleted", p_target_type: "user", p_target_id: user.id,
    p_metadata: {}, p_ip_hash: ipHash(await headers()),
  } as never);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, message: "Suppression impossible, contacte le support." };
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/?compte=supprime");
}
