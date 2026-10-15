import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";
import { syncSubscription, userIdForCustomer } from "@/lib/billing/sync";
import { emails, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { PlanLimits } from "@/lib/db/types";

/**
 * Stripe webhooks: signature verified on the raw body, idempotent (event ids
 * stored in stripe_events, every handler is itself idempotent), never trusts
 * the client. Configure the endpoint for: checkout.session.completed,
 * customer.subscription.created|updated|deleted|trial_will_end,
 * invoice.paid, invoice.payment_failed.
 */
export async function POST(request: NextRequest) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "not configured" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: seen } = await db.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handle(event);
  } catch (e) {
    console.error("stripe webhook failed", event.type, e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 }); // Stripe retries
  }
  await db.from("stripe_events").insert({ id: event.id, type: event.type } as never);
  return NextResponse.json({ received: true });
}

async function emailOf(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("profiles").select("email").eq("id", userId).maybeSingle();
  return (data as { email: string | null } | null)?.email ?? null;
}

function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const s = invoice.parent?.subscription_details?.subscription;
  return typeof s === "string" ? s : s?.id ?? null;
}

async function handle(event: Stripe.Event) {
  const stripe = getStripe();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
        );
        if (!sub.metadata?.user_id && session.client_reference_id) sub.metadata = { ...sub.metadata, user_id: session.client_reference_id };
        const res = await syncSubscription(sub);
        if (res) {
          const email = await emailOf(res.userId);
          if (email) await sendEmail(email, "Ton plan Flowrima est actif", emails.subscriptionStarted("Artiste"));
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object;
      const userId = await userIdForCustomer(typeof sub.customer === "string" ? sub.customer : sub.customer.id, sub.metadata?.user_id);
      const email = userId ? await emailOf(userId) : null;
      if (email) {
        await sendEmail(
          email,
          "Ton essai Flowrima se termine bientôt",
          `<p>Ton essai gratuit du plan Artiste se termine dans 3 jours. Sans action de ta part, l'abonnement démarre automatiquement. Tu peux l'annuler en un clic depuis ton compte.</p>`,
        );
      }
      break;
    }
    case "invoice.paid": {
      // Monthly prod credits (phase 3 feature, ledger ready now). Idempotent per invoice.
      const invoice = event.data.object;
      const subId = subscriptionIdOfInvoice(invoice);
      if (!subId || !invoice.customer) break;
      const sub = await stripe.subscriptions.retrieve(subId);
      const res = await syncSubscription(sub);
      if (!res) break;
      const { data: plan } = await createAdminClient().from("plans").select("limits").eq("id", res.plan).maybeSingle();
      const credits = ((plan as { limits: PlanLimits } | null)?.limits.prod_credits_monthly) ?? 0;
      await createAdminClient().rpc("renew_monthly_credits", { p_user: res.userId, p_amount: credits, p_reference: invoice.id } as never);
      break;
    }
    case "invoice.payment_failed": {
      // Dunning: Stripe Smart Retries + our e-mail; the plan stays active while past_due.
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const userId = customerId ? await userIdForCustomer(customerId) : null;
      if (!userId) break;
      const email = await emailOf(userId);
      if (email) await sendEmail(email, "Ton paiement Flowrima n'est pas passé", emails.paymentFailed());
      await createAdminClient().rpc("log_audit", {
        p_actor: userId, p_action: "invoice.payment_failed", p_target_type: "invoice", p_target_id: invoice.id,
        p_metadata: { attempt: invoice.attempt_count },
      } as never);
      break;
    }
    default:
      break;
  }
}
