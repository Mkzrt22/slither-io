import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * Supabase client bound to the current user's session (RLS applies).
 * Create one per request — never share it.
 */
export async function createClient() {
  // User data is always rendered at request time (never in a prerendered or
  // prefetched shell): the auth client reads the clock to check token expiry.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies are read-only there.
            // The proxy refreshes the session on every request, so this is safe.
          }
        },
      },
    },
  );
}
