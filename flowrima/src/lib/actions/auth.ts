"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ipHash, LIMITS, rateLimit } from "@/lib/ratelimit";
import { m } from "@/i18n";
import { siteUrl } from "@/lib/utils";
import { CONSENT_VERSIONS, recordSignupConsents } from "@/lib/consents";

export type AuthState = { ok: boolean; message: string } | null;

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/app";
};

async function limited(h: Headers): Promise<boolean> {
  return !(await rateLimit(`ip:${ipHash(h)}:auth`, LIMITS.auth.limit, LIMITS.auth.window));
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalide"),
  password: z.string().min(8, "8 caractères minimum").max(200),
});

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (await limited(await headers())) return { ok: false, message: "Trop de tentatives, réessaie dans 10 minutes." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: m.auth.invalidCredentials };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (formData.get("terms") !== "on") return { ok: false, message: "Tu dois accepter les CGU pour créer un compte." };
  const h = await headers();
  if (await limited(h)) return { ok: false, message: "Trop de tentatives, réessaie dans 10 minutes." };
  const marketing = formData.get("marketing") === "on";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/app/onboarding`,
      data: { locale: "fr", terms_version: CONSENT_VERSIONS.terms },
    },
  });
  if (error) return { ok: false, message: error.message.includes("registered") ? "Un compte existe déjà avec cet e-mail." : m.common.error };
  if (data.user) await recordSignupConsents(data.user.id, marketing, h);
  if (data.session) redirect("/app/onboarding"); // e-mail confirmation disabled
  return { ok: true, message: m.auth.checkEmail };
}

export async function signInWithMagicLink(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { ok: false, message: "E-mail invalide" };
  if (await limited(await headers())) return { ok: false, message: "Trop de tentatives, réessaie dans 10 minutes." };
  const supabase = await createClient();
  const next = safeNext(formData.get("next"));
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
  });
  if (error) return { ok: false, message: "Impossible d'envoyer le lien. Crée d'abord ton compte." };
  return { ok: true, message: m.auth.magicLinkSent };
}

export async function signInWithProvider(formData: FormData): Promise<void> {
  const provider = formData.get("provider") === "apple" ? "apple" : "google";
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/connexion?error=oauth");
  redirect(data.url);
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { ok: false, message: "E-mail invalide" };
  if (await limited(await headers())) return { ok: false, message: "Trop de tentatives, réessaie dans 10 minutes." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/app/compte%3Freset%3D1`,
  });
  return { ok: true, message: m.auth.resetSent };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
