import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/utils";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app/", "/api/", "/s/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
