import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: BYPASSES Row Level Security. Server-only (webhooks,
 * background jobs, quota RPCs, admin back-office). Every call site must have
 * authorised the user first.
 */
let admin: ReturnType<typeof createClient> | null = null;

export function createAdminClient() {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured (see .env.example)");
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
