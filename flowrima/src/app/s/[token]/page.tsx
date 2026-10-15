import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { Sparkles } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { LyricsView } from "@/components/lyrics/lyrics-view";
import { Badge, Skeleton } from "@/components/ui/card";
import type { LyricContent } from "@/lib/db/types";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Paroles partagées", robots: { index: false, follow: false } };

interface Shared {
  title: string;
  artist: string;
  bpm: number | null;
  musical_key: string | null;
  shared_at: string | null;
  version: { title: string | null; content_json: LyricContent | null; is_ai_generated: boolean; created_at: string } | null;
}

/** Private link: anonymous read through the security-definer get_shared_project() only. */
async function SharedLyrics({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) notFound();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await supabase.rpc("get_shared_project", { p_token: token });
  const shared = data as Shared | null;
  if (!shared?.version?.content_json) notFound();
  return (
    <article className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{shared.version.title || shared.title}</h1>
        <p className="text-muted">
          {shared.artist}
          {shared.bpm ? ` · ${shared.bpm} BPM` : ""}
          {shared.musical_key ? ` · ${shared.musical_key}` : ""} · partagé le {formatDate(shared.shared_at)}
        </p>
      </div>
      {shared.version.is_ai_generated && (
        <Badge><Sparkles className="size-3" aria-hidden /> Écrit avec l&apos;aide de l&apos;IA</Badge>
      )}
      <LyricsView sections={shared.version.content_json.sections} />
    </article>
  );
}

export default function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <Logo className="mb-8" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <SharedLyrics params={params} />
      </Suspense>
      <p className="mt-10 text-center text-xs text-muted">Lien privé — ne le partage qu&apos;avec ton équipe.</p>
    </main>
  );
}
