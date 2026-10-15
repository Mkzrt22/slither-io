import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewVerification, setUserRole } from "@/lib/actions/admin";
import type { ArtistProfileRow, ProfileRow } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Utilisateurs" };

async function Users({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const q = (await searchParams).q?.trim().toLowerCase().replace(/[%,()]/g, "").slice(0, 80);
  const db = createAdminClient();
  let query = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(50);
  if (q) query = query.ilike("email", `%${q}%`);
  const [{ data: users }, { data: pending }] = await Promise.all([
    query,
    db.from("artist_profiles").select("*").eq("verification_status", "pending").limit(50),
  ]);
  return (
    <div className="space-y-6">
      <form role="search" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Rechercher un e-mail…" aria-label="Rechercher un e-mail" />
        <Button type="submit" variant="outline">Rechercher</Button>
      </form>
      <Card>
        <CardTitle className="mb-3">Vérifications d&apos;artistes en attente</CardTitle>
        {((pending as ArtistProfileRow[] | null) ?? []).length === 0 ? (
          <p className="text-sm text-muted">Aucune demande.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {((pending as ArtistProfileRow[] | null) ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <span><strong>{a.stage_name}</strong> · code <code>{a.verification_code}</code> (vérifier la bio Instagram)</span>
                <span className="flex gap-2">
                  {(["verified", "rejected"] as const).map((d) => (
                    <form key={d} action={reviewVerification}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="decision" value={d} />
                      <Button type="submit" size="sm" variant={d === "verified" ? "default" : "outline"}>{d === "verified" ? "Valider" : "Refuser"}</Button>
                    </form>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle className="mb-3">Utilisateurs</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-muted"><tr><th className="py-2 font-medium">E-mail</th><th>Plan</th><th>Inscription</th><th>Rôle</th></tr></thead>
            <tbody>
              {((users as ProfileRow[] | null) ?? []).map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-2">{u.email}</td>
                  <td><Badge tone={u.plan === "free" ? "default" : "accent"}>{u.plan}</Badge></td>
                  <td>{formatDate(u.created_at)}</td>
                  <td>
                    <form action={setUserRole} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="role" value={u.role === "admin" ? "user" : "admin"} />
                      <span>{u.role}</span>
                      <Button type="submit" size="sm" variant="ghost">{u.role === "admin" ? "Retirer admin" : "Promouvoir"}</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <>
      <PageHeader title="Utilisateurs" />
      <AdminNav />
      <Suspense fallback={<PageSkeleton />}>
        <Users searchParams={searchParams} />
      </Suspense>
    </>
  );
}
