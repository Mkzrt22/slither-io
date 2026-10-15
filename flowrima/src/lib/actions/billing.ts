"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, requireUser } from "@/lib/auth";
import { getStripe, priceFor, stripeConfigured, type BillingInterval } from "@/lib/billing/stripe";
import { CONSENT_VERSIONS, consentMeta } from "@/lib/consents";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/utils";

export type BillingState = { ok: boolean; message: string } | null;

async function ensureCustomer(userId: string, email: string | null): Promise<string> {
  const profile = await getProfile();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await getStripe().customers.create({
    email: email ?? undefined,
    metadata: { user_id: userId },
    preferred_locales: ["fr"],
  });
  await createAdminClient().from("profiles").update({ stripe_customer_id: customer.id } as never).eq("id", userId);
  return customer.id;
}

/**
 * Stripe Checkout for the Artist plan (7-day trial, Stripe Tax, EU VAT).
 * The express waiver of the withdrawal right (digital content, art. L221-28
 * 13° Code de la consommation) is required and logged before redirecting.
 */
export async function startCheckout(_prev: BillingState, formData: FormData): Promise<BillingState> {
  const user = await requireUser("/app/compte");
  if (!stripeConfigured()) return { ok: false, message: "Le paiement n'est pas encore configuré." };
  const interval: BillingInterval = formData.get("interval") === "year" ? "year" : "month";
  if (formData.get("waiver") !== "on" || formData.get("cgv") !== "on") {
    return { ok: false, message: "Accepte les CGV et l'accès immédiat au service pour continuer." };
  }
  const price = priceFor("artist", interval);
  if (!price) return { ok: false, message: "Offre indisponible." };

  const profile = await getProfile();
  if (profile && profile.plan !== "free") return { ok: false, message: "Tu as déjà un abonnement : gère-le depuis le portail." };

  const h = await headers();
  const meta = consentMeta(h);
  await createAdminClient().from("consents").insert([
    { user_id: user.id, kind: "sales_terms", granted: true, version: CONSENT_VERSIONS.sales_terms, ...meta },
    {
      user_id: user.id, kind: "withdrawal_waiver", granted: true, version: CONSENT_VERSIONS.withdrawal_waiver, ...meta,
      text_snapshot: "Je demande l'accès immédiat au service et renonce expressément à mon droit de rétractation.",
    },
  ] as never);

  const customer = await ensureCustomer(user.id, user.email);
  // A user who already had a trial does not get a second one.
  const { count } = await createAdminClient()
    .from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      metadata: { user_id: user.id },
      ...(count ? {} : { trial_period_days: env().STRIPE_TRIAL_DAYS }),
    },
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    locale: "fr",
    success_url: `${siteUrl()}/app/compte?paiement=ok`,
    cancel_url: `${siteUrl()}/app/compte?paiement=annule`,
  });
  if (!session.url) return { ok: false, message: "Impossible d'ouvrir le paiement." };
  redirect(session.url);
}

/** Stripe customer portal: change card, invoices, cancel in one click. */
export async function openBillingPortal(): Promise<void> {
  const user = await requireUser("/app/compte");
  if (!stripeConfigured()) redirect("/app/compte?paiement=non_configure");
  const customer = await ensureCustomer(user.id, user.email);
  const portal = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${siteUrl()}/app/compte`,
    locale: "fr",
  });
  redirect(portal.url);
}
