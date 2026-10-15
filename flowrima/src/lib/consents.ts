import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ipHash } from "@/lib/ratelimit";
import { m } from "@/i18n";

/** Version of each text the user accepts (bump when the text changes). */
export const CONSENT_VERSIONS = {
  terms: "cgu-2026-10",
  privacy: "privacy-2026-10",
  sales_terms: "cgv-2026-10",
  rights_attestation: "rights-2026-10",
  cookies_analytics: "cookies-2026-10",
  marketing_optin: "marketing-2026-10",
  training_optin: "training-2026-10",
  withdrawal_waiver: "withdrawal-2026-10",
} as const;

export function consentMeta(h: Headers) {
  return { ip_hash: ipHash(h), user_agent: h.get("user-agent")?.slice(0, 400) ?? null };
}

/** Records CGU + privacy (+ marketing) consents in the register (server only). */
export async function recordSignupConsents(userId: string, marketing: boolean, h: Headers) {
  const base = { user_id: userId, ...consentMeta(h) };
  const rows = [
    { ...base, kind: "terms", granted: true, version: CONSENT_VERSIONS.terms, text_snapshot: m.auth.acceptTerms },
    { ...base, kind: "privacy", granted: true, version: CONSENT_VERSIONS.privacy },
    { ...base, kind: "marketing_optin", granted: marketing, version: CONSENT_VERSIONS.marketing_optin },
  ];
  const admin = createAdminClient();
  await admin.from("consents").insert(rows as never);
  if (marketing) await admin.from("profiles").update({ marketing_optin: true } as never).eq("id", userId);
}
