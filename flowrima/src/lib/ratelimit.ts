import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting stored in Postgres (public.rate_limit_hit).
 * Keys combine the user id or a hashed IP with the route. Fails open if the
 * database is unreachable so that a hiccup never locks everyone out — quotas
 * remain enforced separately.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    } as never);
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/** Salted hash of the client IP (we never store raw IPs — RGPD). */
export function ipHash(headers: Headers): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown";
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-16) ?? "flowrima";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export const LIMITS = {
  generate: { limit: 6, window: 60 },
  retouch: { limit: 30, window: 60 },
  assist: { limit: 40, window: 60 },
  import: { limit: 30, window: 60 },
  waitlist: { limit: 5, window: 600 },
  metadata: { limit: 30, window: 60 },
  auth: { limit: 10, window: 600 },
} as const;
