import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { POSTS } from "@/content/blog/posts";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Blog — écriture, rimes et flow",
  description: "Conseils d'écriture pour rappeurs et chanteurs : inspiration, rimes multisyllabiques, syllabes et BPM.",
};

export default function BlogIndex() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Le blog</h1>
      <p className="mb-8 text-muted">Écriture, rimes, flow : des méthodes concrètes pour sortir plus souvent.</p>
      <div className="space-y-4">
        {POSTS.map((p) => (
          <Card key={p.slug} className="transition-colors hover:border-accent/60">
            <Link href={`/blog/${p.slug}`} className="block space-y-2">
              <p className="text-xs text-muted">
                {formatDate(p.date)} · {p.readingMinutes} min de lecture
              </p>
              <h2 className="text-xl font-semibold">{p.title}</h2>
              <p className="text-muted">{p.description}</p>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
