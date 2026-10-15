import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminEmails } from "@/lib/env";
import type { ArtistProfileRow, ProfileRow } from "@/lib/db/types";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Current user from the verified session JWT (getClaims verifies the token).
 * Deduplicated per request with React cache(). Reads cookies: call it inside
 * a <Suspense> boundary (Cache Components) or from a Route Handler / Action.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  return { id: sub, email: (data.claims.email as string | undefined) ?? null };
});

export async function requireUser(next = "/app"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/connexion?next=${encodeURIComponent(next)}`);
  return user;
}

export const getProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as ProfileRow | null) ?? null;
});

/** The user's artist profiles (Label plan: up to 5). */
export const getArtists = cache(async (): Promise<ArtistProfileRow[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("artist_profiles").select("*").order("created_at");
  return (data as ArtistProfileRow[] | null) ?? [];
});

/** Active artist: the first one for now (artist switcher comes with the Label plan). */
export async function getActiveArtist(): Promise<ArtistProfileRow | null> {
  const artists = await getArtists();
  return artists[0] ?? null;
}

export async function isAdmin(): Promise<boolean> {
  const profile = await getProfile();
  if (!profile) return false;
  return profile.role === "admin" || adminEmails().includes((profile.email ?? "").toLowerCase());
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/app/admin");
  if (!(await isAdmin())) redirect("/app");
  return user;
}
