import type { MetadataRoute } from "next";
import { POSTS } from "@/content/blog/posts";
import { siteUrl } from "@/lib/utils";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages = ["", "/tarifs", "/faq", "/blog", "/legal/mentions-legales", "/legal/cgu", "/legal/cgv", "/legal/confidentialite", "/legal/cookies"];
  return [
    ...pages.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 })),
    ...POSTS.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.date, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
