import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import type { PlanId } from "@/lib/db/types";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripe) return stripe;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  stripe = new Stripe(key, { appInfo: { name: "Flowrima" } });
  return stripe;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ARTIST_MONTHLY);
}

export type BillingInterval = "month" | "year";

export function priceFor(plan: Exclude<PlanId, "free">, interval: BillingInterval): string | undefined {
  const e = env();
  if (plan === "artist") return interval === "year" ? e.STRIPE_PRICE_ARTIST_YEARLY : e.STRIPE_PRICE_ARTIST_MONTHLY;
  return undefined; // Pro / Label: phase 2
}

/** Maps a Stripe price back to our plan (webhooks). */
export function planForPrice(priceId: string | null | undefined): { plan: PlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  const e = env();
  if (priceId === e.STRIPE_PRICE_ARTIST_MONTHLY) return { plan: "artist", interval: "month" };
  if (priceId === e.STRIPE_PRICE_ARTIST_YEARLY) return { plan: "artist", interval: "year" };
  return null;
}
