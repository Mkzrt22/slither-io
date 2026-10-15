import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { StatTile } from "@/components/dna/charts";
import { Card, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { grossMargin, maxGenerationsForMargin } from "@/lib/ai/pricing";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import type { GenerationRow, PlanRow } from "@/lib/db/types";
import { formatDate, formatEUR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

interface Metrics {
  users_total: number;
  users_new: number;
  by_plan: Record<string, number>;
  subscriptions: { trialing: number; active: number; past_due: number; canceled_period: number };
  mrr_cents: number;
  churn_rate: number;
  ai_cost_usd: number;
  ai_cost_by_type: Record<string, { calls: number; cost_usd: number; avg_cost_usd: number; avg_input_tokens: number; avg_output_tokens: number; cache_read_share: number | null }>;
  ai_cost_per_active_user_usd: number | null;
  ai_cost_by_plan_usd: Record<string, { users: number; cost_usd: number; per_user_usd: number }>;
  generations_by_status: Record<string, number>;
  activation_rate: number | null;
  exports_pdf: number;
  moderation_open: number;
  errors_7d: number;
  waitlist: number;
}

const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 1000) / 10} %`;
// Infra per paying user (Vercel + Supabase + Inngest + e-mails), conservative estimate in EUR.
const INFRA_PER_USER_EUR = 0.35;

async function Overview() {
  await requireAdmin();
  const db = createAdminClient();
  const [{ data }, { data: errors }, { data: plans }] = await Promise.all([
    db.rpc("admin_metrics", { p_days: 30 } as never),
    db.from("generations").select("id, type, error, created_at, owner_id").eq("status", "error").order("created_at", { ascending: false }).limit(15),
    db.from("plans").select("*").order("sort_order"),
  ]);
  const mx = data as unknown as Metrics;
  const fx = env().USD_TO_EUR;
  const lyrics = mx.ai_cost_by_type.lyrics;
  const retouch = mx.ai_cost_by_type.retouch;
  // Fallback estimates when no traffic yet (see docs/COSTS.md)
  const costPerGenEUR = (lyrics?.avg_cost_usd ?? 0.17) * fx;
  const costPerRetouchEUR = (retouch?.avg_cost_usd ?? 0.012) * fx;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="MRR" value={formatEUR(mx.mrr_cents)} hint={`${mx.subscriptions.active} actifs · ${mx.subscriptions.trialing} en essai`} />
        <StatTile label="Churn (30 j)" value={pct(mx.churn_rate)} hint={`${mx.subscriptions.canceled_period} résiliations`} />
        <StatTile label="Utilisateurs" value={`${mx.users_total}`} hint={`+${mx.users_new} sur 30 j · liste d'attente ${mx.waitlist}`} />
        <StatTile label="Activation" value={pct(mx.activation_rate)} hint="ADN généré en moins de 24 h" />
        <StatTile label="Coût IA (30 j)" value={formatEUR(Math.round(mx.ai_cost_usd * fx * 100))} hint={`${(mx.ai_cost_per_active_user_usd ?? 0).toFixed(3)} $ / utilisateur actif`} />
        <StatTile label="Paiements en retard" value={`${mx.subscriptions.past_due}`} hint="relances Stripe en cours" />
        <StatTile label="Modération" value={`${mx.moderation_open}`} hint="signalements ouverts" />
        <StatTile label="Erreurs (7 j)" value={`${mx.errors_7d}`} hint={`exports PDF : ${mx.exports_pdf}`} />
      </div>

      <Card>
        <CardTitle className="mb-3">Coût IA par fonctionnalité (30 jours)</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-muted">
              <tr><th className="py-2 font-medium">Type</th><th>Appels</th><th>Coût total</th><th>Coût moyen</th><th>Tokens in / out</th><th>Part du cache</th></tr>
            </thead>
            <tbody>
              {Object.entries(mx.ai_cost_by_type).map(([type, c]) => (
                <tr key={type} className="border-t border-border tabular-nums">
                  <td className="py-2">{type}</td>
                  <td>{c.calls}</td>
                  <td>{c.cost_usd.toFixed(2)} $</td>
                  <td>{c.avg_cost_usd.toFixed(4)} $</td>
                  <td>{c.avg_input_tokens} / {c.avg_output_tokens}</td>
                  <td>{pct(c.cache_read_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-1">Marge brute par plan et quota recommandé</CardTitle>
        <p className="mb-3 text-sm text-muted">
          Coût mesuré par génération : {costPerGenEUR.toFixed(3)} € · par retouche : {costPerRetouchEUR.toFixed(4)} €. Hypothèse : un utilisateur
          consomme en moyenne 35 % de son quota. Objectif : marge brute ≥ 70 %.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted">
              <tr><th className="py-2 font-medium">Plan</th><th>Prix TTC</th><th>Quota actuel</th><th>Coût IA moyen</th><th>Marge (35 %)</th><th>Marge (100 %)</th><th>Quota max à 70 %</th></tr>
            </thead>
            <tbody>
              {((plans as PlanRow[] | null) ?? []).filter((p) => p.price_monthly_cents > 0).map((p) => {
                const price = p.price_monthly_cents / 100;
                const usage = (u: number) => p.limits.lyrics_generations * u * costPerGenEUR + p.limits.retouches * u * 0.3 * costPerRetouchEUR;
                const avg = grossMargin({ priceTTC: price, aiCostEUR: usage(0.35), infraCostEUR: INFRA_PER_USER_EUR });
                const worst = grossMargin({ priceTTC: price, aiCostEUR: usage(1), infraCostEUR: INFRA_PER_USER_EUR });
                const max = maxGenerationsForMargin({
                  priceTTC: price,
                  costPerGenerationEUR: costPerGenEUR,
                  otherAiCostEUR: p.limits.retouches * 0.35 * 0.3 * costPerRetouchEUR,
                  infraCostEUR: INFRA_PER_USER_EUR,
                });
                return (
                  <tr key={p.id} className="border-t border-border tabular-nums">
                    <td className="py-2">{PLAN_CATALOG.find((c) => c.id === p.id)?.name ?? p.id}</td>
                    <td>{price.toFixed(2)} €</td>
                    <td>{p.limits.lyrics_generations} gén.</td>
                    <td>{usage(0.35).toFixed(2)} €</td>
                    <td className={avg.margin < 0.7 ? "text-warning" : "text-success"}>{pct(avg.margin)}</td>
                    <td className={worst.margin < 0.5 ? "text-danger" : ""}>{pct(worst.margin)}</td>
                    <td>{max} gén.</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Ajuste les quotas dans « Plans et quotas ». Les quotas promis aux abonnés en cours ne doivent pas baisser en cours de période.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-3">Coût IA par plan (30 j)</CardTitle>
          <ul className="space-y-1 text-sm">
            {Object.entries(mx.ai_cost_by_plan_usd).map(([plan, c]) => (
              <li key={plan} className="flex justify-between tabular-nums">
                <span>{plan} ({c.users} utilisateurs actifs)</span>
                <span>{c.per_user_usd.toFixed(3)} $ / utilisateur</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Répartition des plans : {Object.entries(mx.by_plan).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
        </Card>
        <Card>
          <CardTitle className="mb-3">Dernières erreurs</CardTitle>
          {((errors as GenerationRow[] | null) ?? []).length === 0 ? (
            <p className="text-sm text-muted">Aucune erreur récente.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {((errors as GenerationRow[] | null) ?? []).map((e) => (
                <li key={e.id} className="border-t border-border pt-2">
                  <span className="text-muted">{formatDate(e.created_at)} · {e.type} · {e.owner_id.slice(0, 8)}</span>
                  <p className="break-words">{e.error}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Traces détaillées : Sentry.</p>
        </Card>
      </div>
      <Card className="text-sm text-muted">
        Beatmakers et validation des prods : phase 2 (marketplace Stripe Connect).
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Back-office" description="KPI, coûts IA et marge, erreurs." />
      <AdminNav />
      <Suspense fallback={<PageSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}
