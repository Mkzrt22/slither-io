import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanId } from "@/lib/db/types";
import { planForPrice } from "./stripe";

const ACTIVE = new Set(["trialing", "active", "past_due"]);
const toISO = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

export async function userIdForCustomer(customerId: string, metadataUserId?: string | null): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const { data } = await createAdminClient().from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Mirrors a Stripe subscription into `subscriptions` and sets the effective
 * plan on the profile. Idempotent (upsert on the Stripe id), so replayed or
 * out-of-order webhooks converge to Stripe's state.
 * past_due keeps the plan during dunning (Smart Retries); unpaid / canceled
 * fall back to the free plan.
 */
export async function syncSubscription(sub: Stripe.Subscription): Promise<{ userId: string; plan: PlanId } | null> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await userIdForCustomer(customerId, sub.metadata?.user_id);
  if (!userId) return null;
  const item = sub.items.data[0];
  const mapped = planForPrice(item?.price?.id);
  const db = createAdminClient();
  await db.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id: item?.price?.id ?? null,
      plan: mapped?.plan ?? "artist",
      billing_interval: mapped?.interval ?? (item?.price?.recurring?.interval === "year" ? "year" : "month"),
      status: sub.status,
      current_period_start: toISO(item?.current_period_start),
      current_period_end: toISO(item?.current_period_end),
      cancel_at_period_end: sub.cancel_at_period_end,
      trial_end: toISO(sub.trial_end),
    } as never,
    { onConflict: "stripe_subscription_id" },
  );

  // Effective plan = best active subscription of the user
  const { data: subs } = await db.from("subscriptions").select("plan, status").eq("user_id", userId);
  const order: PlanId[] = ["free", "artist", "pro", "label"];
  const plan = ((subs as Array<{ plan: PlanId; status: string }> | null) ?? [])
    .filter((s) => ACTIVE.has(s.status))
    .reduce<PlanId>((best, s) => (order.indexOf(s.plan) > order.indexOf(best) ? s.plan : best), "free");
  await db.from("profiles").update({ plan, stripe_customer_id: customerId } as never).eq("id", userId);
  await db.rpc("log_audit", {
    p_actor: userId, p_action: "subscription.sync", p_target_type: "subscription", p_target_id: sub.id,
    p_metadata: { status: sub.status, plan },
  } as never);
  return { userId, plan };
}
