import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Search } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { requireUser } from "@/lib/auth";
import { getProjects } from "@/lib/data/queries";
import type { ProjectStatus } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Projets" };

const STATUSES: ProjectStatus[] = ["idea", "writing", "ready", "released"];
const TONE = { idea: "default", writing: "warning", ready: "accent", released: "success" } as const;

async function ProjectList({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string }> }) {
  await requireUser("/app/projets");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.statut as ProjectStatus) ? (sp.statut as ProjectStatus) : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const projects = await getProjects({ q, status });
  return (
    <>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Titre ou thème…" aria-label={m.common.search} />
        <Select name="statut" defaultValue={status ?? ""} aria-label="Statut">
          <option value="">{m.common.all}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{m.projects.status[s]}</option>
          ))}
        </Select>
        <Button type="submit" variant="outline"><Search aria-hidden /> {m.common.search}</Button>
      </form>
      {projects.length === 0 ? (
        <EmptyState
          title={q || status ? "Aucun projet ne correspond" : m.projects.empty}
          description={m.projects.emptyHelp}
          action={<Button asChild><Link href="/app/studio">{m.studio.newSong}</Link></Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/app/studio/${p.id}`} prefetch={false}>
                <Card className="h-full space-y-2 p-4 transition-colors hover:border-accent/60">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-semibold">{p.title}</p>
                    <Badge tone={TONE[p.status]}>{m.projects.status[p.status]}</Badge>
                  </div>
                  {p.theme && <p className="line-clamp-2 text-sm text-muted">{p.theme}</p>}
                  <p className="text-xs text-muted">
                    {m.projects.updated} {formatDate(p.updated_at)}
                    {p.bpm ? ` · ${p.bpm} BPM` : ""}
                    {p.share_token ? " · partagé" : ""}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string }> }) {
  return (
    <>
      <PageHeader
        title={m.projects.title}
        actions={<Button asChild><Link href="/app/studio"><Plus aria-hidden /> {m.studio.newSong}</Link></Button>}
      />
      <Suspense fallback={<PageSkeleton />}>
        <ProjectList searchParams={searchParams} />
      </Suspense>
    </>
  );
}
