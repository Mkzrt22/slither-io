import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewFlag } from "@/lib/actions/admin";
import type { ModerationFlagRow } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Modération" };

async function Queue() {
  await requireAdmin();
  const { data } = await createAdminClient()
    .from("moderation_flags")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const flags = (data as ModerationFlagRow[] | null) ?? [];
  if (!flags.length) return <EmptyState title="File de modération vide" description="Aucun signalement en attente." />;
  return (
    <ul className="space-y-3">
      {flags.map((f) => (
        <li key={f.id}>
          <Card className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={f.source === "user_report" ? "warning" : "default"}>{f.source}</Badge>
              {f.category && <Badge>{f.category}</Badge>}
              <span className="text-muted">{formatDate(f.created_at)} · utilisateur {f.user_id.slice(0, 8)}</span>
            </div>
            {f.reason && <p className="text-sm">{f.reason}</p>}
            {f.excerpt && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs">{f.excerpt}</pre>}
            <div className="flex gap-2">
              <form action={reviewFlag}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="status" value="dismissed" />
                <Button type="submit" size="sm" variant="outline">Classer sans suite</Button>
              </form>
              <form action={reviewFlag}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="status" value="actioned" />
                <Button type="submit" size="sm" variant="destructive">Action prise</Button>
              </form>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function ModerationPage() {
  return (
    <>
      <PageHeader title="Modération" description="Refus du modèle, demandes bloquées et signalements des utilisateurs." />
      <AdminNav />
      <Suspense fallback={<PageSkeleton />}>
        <Queue />
      </Suspense>
    </>
  );
}
