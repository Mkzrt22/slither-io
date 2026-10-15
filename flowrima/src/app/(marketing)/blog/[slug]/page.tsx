import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { POSTS, getPost, type Block } from "@/content/blog/posts";
import { formatDate, siteUrl } from "@/lib/utils";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.description, publishedTime: post.date },
  };
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "h2":
      return <h2 className="mt-8 text-2xl font-semibold">{block.text}</h2>;
    case "ul":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      );
    case "quote":
      return <blockquote className="border-l-4 border-accent pl-4 text-lg italic">{block.text}</blockquote>;
    default:
      return <p>{block.text}</p>;
  }
}

async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: `${siteUrl()}/blog/${post.slug}`,
    publisher: { "@type": "Organization", name: "Flowrima" },
  };
  return (
    <article className="space-y-4 text-[1.0625rem] leading-relaxed">
      <p className="text-sm text-muted">
        {formatDate(post.date)} · {post.readingMinutes} min de lecture
      </p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{post.title}</h1>
      <p className="text-lg text-muted">{post.description}</p>
      {post.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
      <div className="mt-10 rounded-2xl border border-border bg-surface p-5">
        <p className="mb-3 font-semibold">Écris des paroles qui sonnent comme toi</p>
        <Button asChild>
          <Link href="/inscription">Essayer Flowrima gratuitement</Link>
        </Button>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </article>
  );
}

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/blog" className="mb-6 inline-block text-sm text-accent-text">← Tous les articles</Link>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Article params={params} />
      </Suspense>
    </div>
  );
}
