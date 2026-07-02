# AutoSite WaaS

A multi-tenant, AI-generated Website-Builder-as-a-Service, scaffolded as a pnpm monorepo.

## Layout

```
autosite-waas/
├── apps/
│   └── tenant-router/     # Next.js app: host-based tenant routing + AST renderer
└── packages/
    ├── database/          # Prisma schema + shared client (multi-tenant models)
    └── ai-core/           # Anthropic-powered website AST generator
```

`apps/saas-platform` (marketing site, tenant dashboard, billing) is not yet scaffolded —
add it here once its requirements are defined.

## How it fits together

1. `packages/ai-core` calls Claude with a JSON schema for a `WebsiteAST` (theme + an
   ordered list of section nodes: navbar, hero, features, form, footer) and returns it
   as validated tool-call output — no fragile prose-to-JSON parsing.
2. That AST is persisted as `Website.astJson` in Postgres via `packages/database`
   (Prisma models: `User`, `Tenant`, `TenantOwner`, `Website`, `Lead`, `AnalyticsEvent`).
3. `apps/tenant-router` resolves the incoming `Host` header in `middleware.ts`, rewrites
   the request to `/render-tenant/[tenant]`, looks up the tenant's published `Website`,
   and renders its AST with `components/ASTParser.tsx`.
4. The rendered lead-capture form posts to `/api/leads/[websiteId]`, which stores
   submissions as `Lead` rows tied to that website.

## Getting started

```bash
cd autosite-waas
pnpm install
cp .env.example .env      # set DATABASE_URL and ANTHROPIC_API_KEY
pnpm db:generate
pnpm --filter @autosite/database migrate
pnpm dev                  # runs apps/tenant-router on :3000
```

Locally, tenants are resolved from subdomains of `localhost:3000` (e.g.
`acme.localhost:3000`); in production, subdomains of `autosite.com`.
