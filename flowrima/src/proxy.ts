import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, images, the service worker and webhooks
    // (Stripe / Inngest authenticate with their own signatures).
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|api/stripe/webhook|api/inngest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
