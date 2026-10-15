"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client (anon key + user session; RLS applies). Used for Realtime. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
