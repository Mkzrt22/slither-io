"use server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { CONSENT_VERSIONS, consentMeta } from "@/lib/consents";

/** Logs the cookie choice in the consents register (signed-in users only). */
export async function recordCookieConsent(granted: boolean): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.from("consents").insert({
    kind: "cookies_analytics",
    granted: Boolean(granted),
    version: CONSENT_VERSIONS.cookies_analytics,
    ...consentMeta(await headers()),
  });
}
