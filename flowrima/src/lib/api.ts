import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";

/** JSON error helper. */
export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/** Auth + per-user rate limit for Route Handlers. */
export async function guard(
  route: string,
  limit: { limit: number; window: number },
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { response: jsonError(401, "unauthorized", "Connecte-toi pour continuer.") };
  if (!(await rateLimit(`user:${user.id}:${route}`, limit.limit, limit.window))) {
    return { response: jsonError(429, "rate_limited", "Trop de requêtes, patiente quelques secondes.") };
  }
  return { user };
}
