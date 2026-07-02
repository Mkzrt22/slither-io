# AUTOSITE SAAS
## Master Architectural Design Specification — Autonomous Website-Builder-as-a-Service
### Revision 1.0

---

## EXECUTIVE SUMMARY

AutoSite is a multi-tenant platform that converts a natural-language business description into a deployed, production-grade website inside a bounded latency budget, then keeps that site optimized via a set of background agents operating on fixed schedules and statistically-gated triggers. The system is composed of four subsystems: a content/design synthesis engine, a DevOps provisioning pipeline, a self-healing optimization matrix, and a metered billing layer.

A note on scope, stated plainly: every "autonomous" action in this document — auto-merging an A/B winner, auto-merging a security patch, auto-charging a card for an upsell — is gated by an explicit, machine-checkable condition (statistical significance threshold, passing test suite, prior user consent to a billing policy). None of it is "no human ever looks at this system." Someone still owns the thresholds. That's not a hedge, it's the actual design — a merge policy with no gate isn't automation, it's an outage waiting for a Tuesday.

---

## TABLE OF CONTENTS

1. Module 1 — AI Content & Design Synthesis Engine
2. Module 2 — Autonomous DevOps & Micro-Tenant Provisioning
3. Module 3 — Self-Healing & Optimization Matrix (Cron Agents)
4. Module 4 — Financial Layer & Programmatic Monetization Engine
5. Technical Schemas
6. End-to-End Flow: Prompt → Live Edge Deployment

---

## MODULE 1: AI CONTENT & DESIGN SYNTHESIS ENGINE

### 1.1 Processing Pipeline

```
User Prompt ("I run a small-batch coffee roastery in Portland")
        │
        ▼
[Schema Translator]  — LLM call, structured-output mode, fixed JSON schema
        │  extracts: industry_vertical, brand_tone, target_audience,
        │            required_pages[], feature_flags[]
        ▼
[Design Token Generator] — maps industry_vertical + brand_tone to a
        │  palette/typography preset via a lookup table + LLM refinement pass
        ▼
[Component Composer] — assembles a page-by-page component tree from a
        │  fixed library of ~60 Next.js/Tailwind components
        ▼
[Copy Generator] — fills every text slot in the component tree with
        │  on-brand copy, one LLM call per page, temperature 0.4
        ▼
[Asset Resolver] — queries Unsplash/Pexels API per image slot using
        │  keyword tags derived from industry_vertical + section context
        ▼
[AST Emission] — serializes the finished tree to the Website_State_Object
                  JSON schema (§5.1)
```

### 1.2 Schema Translation

```typescript
interface IntakeExtraction {
  industry_vertical: string;
  brand_tone: "playful" | "corporate" | "minimal" | "rustic" | "luxury";
  target_audience: string;
  required_pages: string[];
  feature_flags: ("booking" | "ecommerce" | "blog" | "newsletter" | "menu")[];
}

async function extractIntake(userPrompt: string): Promise<IntakeExtraction> {
  const response = await llmClient.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [INTAKE_EXTRACTION_TOOL],   // JSON-schema-constrained tool definition
    tool_choice: { type: "tool", name: "extract_intake" },
    messages: [{ role: "user", content: userPrompt }],
  });
  const toolUse = response.content.find(b => b.type === "tool_use");
  return toolUse.input as IntakeExtraction;
}
```

### 1.3 Component Composer

The composer does not generate arbitrary layout code. It selects and parameterizes components from a fixed, pre-audited library (`@autosite/component-registry`), which is the actual mechanism keeping generated sites accessible and performant — the LLM chooses *which* validated component and *what props*, never raw markup:

```typescript
function composePage(pageSpec: PageSpec, tokens: DesignTokens): ComponentNode[] {
  const template = PAGE_TEMPLATES[pageSpec.page_type]; // e.g. "landing", "menu", "contact"
  return template.slots.map(slot => ({
    component: selectComponent(slot.category, tokens.brand_tone),
    props: resolveProps(slot, tokens),
    children: slot.children?.map(c => composePage(c, tokens)) ?? [],
  }));
}
```

### 1.4 Output Contract

The synthesis engine's sole output is a `Website_State_Object` (schema at §5.1) — a declarative AST, never raw generated HTML/JS. This is what makes Module 2's provisioning step deterministic: the same AST always compiles to the same Next.js project via a static code generator, so the LLM is never the thing writing files to disk.

---

## MODULE 2: AUTONOMOUS DEVOPS & MICRO-TENANT PROVISIONING

### 2.1 Infrastructure Stack

| Layer | Provider | Purpose |
|---|---|---|
| Hosting | Vercel Enterprise API | Edge deployment, preview URLs, instant rollback |
| DNS/SSL | Cloudflare Enterprise API | Custom domain propagation, automated cert issuance |
| Source Control | GitHub App (per-tenant isolated repo) | Auditable history, enables Module 3 agents to open real PRs |
| Database | PostgreSQL, schema-per-tenant | Logical isolation, tenant data never cross-queryable by default |

### 2.2 Deployment Loop

```typescript
async function provisionTenantSite(tenantId: string, ast: WebsiteStateObject): Promise<string> {
  // 1. Compile AST to a static Next.js project on disk (deterministic codegen, no LLM in this step)
  const projectDir = await codegen.compileToNextProject(ast, `/build/${tenantId}`);

  // 2. Create an isolated GitHub repo for this tenant (idempotent — reuses existing repo on redeploy)
  const repo = await github.repos.createOrGet({
    org: "autosite-tenants",
    name: `tenant-${tenantId}`,
    private: true,
  });
  await github.git.pushTree(repo, projectDir, { branch: "main", message: `Initial generation: ${ast.meta.site_name}` });

  // 3. Trigger a Vercel deployment bound to that repo
  const deployment = await vercel.deployments.create({
    project: `tenant-${tenantId}`,
    gitSource: { repoId: repo.id, ref: "main" },
    target: "production",
  });

  // 4. Poll build status with a 45s hard budget; on timeout, serve last-known-good deployment
  const build = await pollWithTimeout(
    () => vercel.deployments.get(deployment.id),
    (d) => d.readyState === "READY" || d.readyState === "ERROR",
    { timeoutMs: 45_000, intervalMs: 1_500 }
  );
  if (build.readyState === "ERROR") {
    throw new ProvisioningError(tenantId, build.errorMessage);
  }

  // 5. Map the tenant's subdomain via Cloudflare (custom domains are a separate, user-initiated step)
  const subdomain = `${slugify(ast.meta.site_name)}.sites.autosite.app`;
  await cloudflare.dns.upsertRecord({
    zone: "sites.autosite.app",
    type: "CNAME",
    name: subdomain,
    content: build.url,
    proxied: true, // Cloudflare-managed SSL, no cert step needed for subdomains
  });

  await db.tenantSites.upsert({ tenantId, subdomain, vercelDeploymentId: deployment.id, status: "live" });
  return `https://${subdomain}`;
}
```

Custom domains (`www.customerbusiness.com`) go through a separate, explicitly user-triggered flow — the tenant adds a CNAME on their own registrar, AutoSite verifies ownership via a DNS TXT challenge, and only then does Cloudflare issue the certificate. This step is deliberately **not** part of the autonomous loop: pointing DNS you don't control at infrastructure you don't own is exactly the kind of action that should require a human clicking "verify."

---

## MODULE 3: THE SELF-HEALING & OPTIMIZATION MATRIX

Each agent below runs as an isolated scheduled job (not a long-lived process with standing write access) — it wakes, reads, proposes a change as a PR, evaluates its own gate condition, and either merges or leaves the PR for human review.

### 3.1 SEO Daemon

```typescript
// Cron: 0 4 */3 * *  (every 72 hours, 4am UTC)
async function seoDaemonTick(tenantId: string) {
  const trends = await googleSearchConsole.getQueries(tenantId, { days: 30 });
  const underperforming = trends.filter(q => q.impressions > 100 && q.avgPosition > 15);

  const patch = await generateMetadataPatch(tenantId, underperforming);
  // patch touches: <title>, meta description, image alt text, h1-h3 hierarchy — never body copy semantics
  const pr = await github.pulls.create({
    repo: `tenant-${tenantId}`,
    branch: `seo/auto-${Date.now()}`,
    title: "SEO Daemon: metadata refresh from Search Console trends",
    files: patch.files,
  });

  const checks = await runAutomatedChecks(pr); // lighthouse-seo score, broken-link check, diff-size guard
  if (checks.passed && patch.diffLineCount < 40) {
    await github.pulls.merge(pr, { method: "squash" });
  }
  // else: left open for tenant/human review, tenant notified via dashboard + email
}
```

### 3.2 A/B Growth Hacker

```typescript
// Continuous: reads a rolling click-telemetry stream, not a fixed cron
async function evaluateActiveExperiment(tenantId: string, experimentId: string) {
  const stats = await telemetry.getConversionStats(experimentId); // { variantA: {n, conversions}, variantB: {...} }
  const result = welchTTest(stats.variantA, stats.variantB);

  const MIN_SAMPLE_SIZE = 1000;   // per variant, hard floor regardless of p-value
  const SIGNIFICANCE_THRESHOLD = 0.95;

  if (stats.variantA.n < MIN_SAMPLE_SIZE || stats.variantB.n < MIN_SAMPLE_SIZE) {
    return; // not enough data yet, no action
  }
  if (result.confidence >= SIGNIFICANCE_THRESHOLD) {
    const winner = result.winningVariant;
    await mergeVariantToProduction(tenantId, experimentId, winner);
    await telemetry.closeExperiment(experimentId, { winner, confidence: result.confidence });
  }
  if (Date.now() - experiment.startedAt > EXPERIMENT_MAX_DURATION_MS) {
    await telemetry.closeExperiment(experimentId, { winner: null, reason: "inconclusive_timeout" });
  }
}
```

Edge-middleware routing splits traffic during the experiment window (`middleware.ts` reads a signed cookie, assigns variant on first visit, sticky thereafter); the merge step above only ever promotes a variant that has already cleared the statistical gate — there is no code path that merges on vibes.

### 3.3 Security Sentry

```typescript
// Cron: 0 */6 * * *  (every 6 hours)
async function securitySentryTick(tenantId: string) {
  const advisories = await github.dependabot.getAlerts(`tenant-${tenantId}`);
  const actionable = advisories.filter(a => a.severity === "high" || a.severity === "critical");

  for (const advisory of actionable) {
    const pr = await github.dependabot.createSecurityUpdatePR(advisory); // GitHub-native, not hand-rolled patching
    const ciResult = await waitForCI(pr, { timeoutMs: 10 * 60_000 });

    if (ciResult.status === "success") {
      await github.pulls.merge(pr, { method: "squash" });
      await notifyTenant(tenantId, { type: "security_patch_applied", advisory });
    } else {
      await escalateToHuman(tenantId, { pr, advisory, reason: "ci_failed" });
    }
  }
}
```

Auto-merge here is gated on the tenant's own CI suite passing, not merely on the patch existing — a security fix that breaks the build gets escalated, not force-merged.

---

## MODULE 4: FINANCIAL LAYER & PROGRAMMATIC MONETIZATION ENGINE

### 4.1 Tier Matrix

| Resource | Starter ($19/mo) | Pro ($59/mo) | Enterprise ($249/mo) |
|---|---|---|---|
| Sites | 1 | 5 | Unlimited |
| AI generation tokens/mo | 500K | 3M | 20M (soft cap, overage billed) |
| Bandwidth cap | 50 GB/mo | 500 GB/mo | 5 TB/mo, overage at $0.08/GB |
| A/B experiments concurrent | 0 (disabled) | 3 | Unlimited |
| SEO Daemon frequency | Weekly | Every 72h | Every 24h |
| Custom domains | 1 | 5 | Unlimited |
| Security Sentry auto-merge | Manual review only | Enabled (see §3.3 gates) | Enabled + Slack escalation routing |
| Support SLA | Community | 24h email | 4h, dedicated Slack channel |

### 4.2 Auto-Upsell Rules

Upsells are policy-gated proposals against a payment method the tenant has already attached and consented to a billing policy for — never a silent charge:

```typescript
async function evaluateUpsellTriggers(tenantId: string) {
  const usage = await getMonthlyUsage(tenantId);
  const plan = await getPlan(tenantId);

  if (usage.bandwidthGB > plan.bandwidthCapGB * 0.9) {
    await proposeUpsell(tenantId, {
      sku: "BANDWIDTH_PACK_100GB",
      priceUsd: 12.00,
      reason: "bandwidth_90pct_threshold",
      requiresExplicitConfirmation: true,
    });
  }

  if (usage.trafficSpike7dPct > 300 && !plan.features.includes("ecommerce")) {
    await proposeUpsell(tenantId, {
      sku: "ECOMMERCE_MODULE_ADDON",
      priceUsd: 29.00,
      reason: "traffic_spike_conversion_opportunity",
      requiresExplicitConfirmation: true,
    });
  }
}

// Actual charge only ever happens from a Stripe webhook fired by explicit tenant confirmation,
// never directly from evaluateUpsellTriggers:
async function onUpsellConfirmed(event: Stripe.Event) {
  const { tenantId, sku } = event.data.object.metadata;
  await stripe.subscriptions.update(await getStripeSubId(tenantId), {
    items: [{ price: SKU_TO_STRIPE_PRICE[sku] }],
    proration_behavior: "create_prorations",
  });
  await provisionFeature(tenantId, sku);
}
```

---

## SECTION 5: TECHNICAL SCHEMAS

### 5.1 JSON Schema — `Website_State_Object`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "WebsiteStateObject",
  "type": "object",
  "required": ["meta", "designTokens", "pages"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["site_name", "industry_vertical", "generated_at"],
      "properties": {
        "site_name": { "type": "string" },
        "industry_vertical": { "type": "string" },
        "generated_at": { "type": "string", "format": "date-time" },
        "ast_version": { "type": "string", "const": "1.0" }
      }
    },
    "designTokens": {
      "type": "object",
      "required": ["palette", "typography"],
      "properties": {
        "palette": {
          "type": "object",
          "properties": {
            "primary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "secondary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "background": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "text": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" }
          }
        },
        "typography": {
          "type": "object",
          "properties": {
            "heading_font": { "type": "string" },
            "body_font": { "type": "string" },
            "scale_ratio": { "type": "number", "minimum": 1.0, "maximum": 2.0 }
          }
        }
      }
    },
    "pages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["route", "page_type", "components"],
        "properties": {
          "route": { "type": "string", "pattern": "^/" },
          "page_type": { "type": "string", "enum": ["landing", "menu", "contact", "about", "blog_index", "blog_post", "shop"] },
          "components": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["component_id", "props"],
              "properties": {
                "component_id": { "type": "string" },
                "props": { "type": "object" },
                "children": { "type": "array", "items": { "$ref": "#/properties/pages/items/properties/components/items" } }
              }
            }
          }
        }
      }
    },
    "featureFlags": {
      "type": "array",
      "items": { "type": "string", "enum": ["booking", "ecommerce", "blog", "newsletter", "menu"] }
    }
  }
}
```

### 5.2 PostgreSQL DDL — Tenant Account Topology

```sql
CREATE TABLE tenant_accounts (
    tenant_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_email         VARCHAR(320) NOT NULL UNIQUE,
    plan_tier           VARCHAR(16) NOT NULL DEFAULT 'starter'
                         CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
    stripe_customer_id  VARCHAR(64) NOT NULL UNIQUE,
    stripe_subscription_id VARCHAR(64),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              VARCHAR(16) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'past_due', 'canceled', 'suspended'))
);

CREATE TABLE tenant_sites (
    site_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
    subdomain           VARCHAR(253) NOT NULL UNIQUE,
    custom_domain        VARCHAR(253) UNIQUE,
    custom_domain_verified BOOLEAN NOT NULL DEFAULT FALSE,
    vercel_project_id    VARCHAR(64) NOT NULL,
    github_repo_id       VARCHAR(64) NOT NULL,
    ast_version          VARCHAR(16) NOT NULL DEFAULT '1.0',
    status                VARCHAR(16) NOT NULL DEFAULT 'live'
                          CHECK (status IN ('provisioning', 'live', 'suspended', 'archived')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bandwidth_usage (
    usage_id             BIGSERIAL PRIMARY KEY,
    site_id              UUID NOT NULL REFERENCES tenant_sites(site_id) ON DELETE CASCADE,
    billing_period_start DATE NOT NULL,
    bytes_served          BIGINT NOT NULL DEFAULT 0,
    requests_served        BIGINT NOT NULL DEFAULT 0,
    UNIQUE (site_id, billing_period_start)
);

CREATE TABLE ai_token_usage (
    usage_id              BIGSERIAL PRIMARY KEY,
    tenant_id             UUID NOT NULL REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
    billing_period_start  DATE NOT NULL,
    tokens_consumed        BIGINT NOT NULL DEFAULT 0,
    operation_type         VARCHAR(32) NOT NULL, -- 'site_generation' | 'seo_patch' | 'copy_regen'
    UNIQUE (tenant_id, billing_period_start, operation_type)
);

CREATE TABLE billing_events (
    event_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
    stripe_event_id        VARCHAR(64) NOT NULL UNIQUE,
    event_type             VARCHAR(64) NOT NULL, -- 'upsell_confirmed' | 'subscription_updated' | 'payment_failed'
    amount_usd_cents        INTEGER,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bandwidth_usage_site_period ON bandwidth_usage (site_id, billing_period_start);
CREATE INDEX idx_billing_events_tenant ON billing_events (tenant_id, created_at DESC);
```

---

## SECTION 6: END-TO-END FLOW — PROMPT TO LIVE EDGE DEPLOYMENT

```
[USER]
   Submits business description via intake form
        │
        ▼
[SCHEMA TRANSLATOR]  (§1.2)
   LLM structured-output call → IntakeExtraction object
        │
        ▼
[DESIGN TOKEN GENERATOR + COMPONENT COMPOSER]  (§1.3)
   Builds Website_State_Object AST (§5.1), validated against JSON schema
   before it is allowed to proceed — invalid AST halts the pipeline here,
   does not fall through to codegen
        │
        ▼
[DETERMINISTIC CODEGEN]
   AST → static Next.js project on disk. No LLM involved in this step;
   same AST always produces byte-identical output.
        │
        ▼
[GITHUB]  create-or-get isolated tenant repo, push generated tree
        │
        ▼
[VERCEL]  deployment triggered off repo push, build runs in Vercel's
   isolated build environment
        │
        ▼
[POLL LOOP, 45s BUDGET]
   READY  ──────────────────────────────┐
   ERROR  → throw ProvisioningError,     │
            surface actionable message   │
            to user, retain last-good    │
            deployment if one exists     │
        │                                │
        ▼                                ▼
[CLOUDFLARE]  CNAME → Vercel URL   [POSTGRES]  tenant_sites row
   subdomain proxied, SSL              committed with status
   auto-issued                          + vercel_project_id
        │                                │
        └────────────────┬───────────────┘
                          ▼
                 [USER'S BROWSER]
              Live URL returned, typically
              well under the 45s budget for
              a single-page/low-asset site;
              multi-page/e-commerce sites may
              consume most of the window and
              stream a "still building" state
              to the user via WebSocket
```

---

*End of document. Filed under `docs/AUTOSITE_SAAS_ARCHITECTURE.md`. Every threshold, cap, and gate condition above is a deliberate design choice, not a stand-in for one — change the numbers, not the principle that something has to check before something else merges.*
