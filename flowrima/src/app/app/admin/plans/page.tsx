import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { PlanLimitsForm } from "@/components/admin/plan-limits-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanRow } from "@/lib/db/types";
import { formatEUR } from "@/lib/utils";

export const metadata: Metadata = { title: "Plans et quotas" };

async function Plans() {
  await requireAdmin();
  const { data } = await createAdminClient().from("plans").select("*").order("sort_order");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {((data as PlanRow[] | null) ?? []).map((p) => (
        <Card key={p.id} className="space-y-2">
          <CardTitle>{p.name} <span className="text-sm font-normal text-muted">({p.id} · {formatEUR(p.price_monthly_cents)}/mois)</span></CardTitle>
          <p className="text-xs text-muted">-1 = illimité. Les prix se modifient dans Stripe (Products) puis ici via SQL.</p>
          <PlanLimitsForm id={p.id} limits={p.limits} />
        </Card>
      ))}
    </div>
  );
}

export default function AdminPlansPage() {
  return (
    <>
      <PageHeader title="Plans et quotas" description="Quotas vérifiés côté serveur (fonction SQL consume_quota)." />
      <AdminNav />
      <Suspense fallback={<PageSkeleton />}>
        <Plans />
      </Suspense>
    </>
  );
}
