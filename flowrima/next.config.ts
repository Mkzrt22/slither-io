import type { NextConfig } from "next";

/**
 * Next.js configuration for Flowrima.
 *
 * - `cacheComponents` + `partialPrefetching`: Next 16 rendering model. Pages are
 *   prerendered as a static shell; anything that reads the session (cookies)
 *   lives inside a <Suspense> boundary and streams at request time.
 * - Security headers are applied to every route. A strict CSP with nonces is
 *   left for a later phase (it forces fully dynamic rendering).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Microphone is reserved for the phase 3 vocal guide; camera/geo never used.
    value: "camera=(), geolocation=(), microphone=(self), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    // The repository root holds another project: pin the workspace root here.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Cover art returned by the official oEmbed / public APIs of each platform.
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "*.dzcdn.net" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "*.sndcdn.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
