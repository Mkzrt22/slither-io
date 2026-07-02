# FABLE 5: ALBION-AS-A-SERVICE (AaaS)
## Comprehensive System Architecture & Game Design Document
### Revision 1.0 — "The Cloud Never Forgets a Chicken"

---

## EXECUTIVE SUMMARY

Albion-as-a-Service (AaaS) is a multi-tenant, horizontally-scaled, morally-reactive action RPG delivery platform. Every player receives a dedicated, sandboxed instantiation of the province of Albion — a **World Tenant** — provisioned in under 400ms via our serverless world-bootstrapping layer, and populated with a fully autonomous cast of NPCs who will remember, resent, and eventually outlive the player's mortal choices.

This document specifies, at production-implementation depth, the seven core subsystems required to run Albion at planet-scale while preserving the thing that has always mattered most: the look on a villager's face when you steal his pie, kick his chicken, and then marry his widow. We have not lost the plot. We have simply put the plot behind a load balancer.

Where classic Fable used a hand-authored morality slider, AaaS uses a **real-time, eventually-consistent, two-axis Karma Vector** replicated across regions with sub-200ms propagation. Where classic Fable had a barkeep who remembered your name, AaaS has a **stateful NPC daemon** running on a 30-second heartbeat, persisting memory to a write-optimized event log, and capable of holding a grudge across infrastructure migrations. This is not a metaphor. The grudge survives the deploy.

---

## TABLE OF CONTENTS

1. Module 1 — The Monolithic Narrative Orchestrator (MNO)
2. Module 2 — Multi-Tenant World Topology & Sharding
3. Module 3 — The Automated Macro-Economy & Fintech Pipeline
4. Module 4 — Autonomous Agent (NPC) Lifecycle & State Machines
5. Module 5 — SaaS Monetization Tier Matrix & Compliance
6. Module 6 — Continuous Integration / Continuous Gameplay (CI/CG)
7. Module 7 — Telemetry, Analytics, and Webhook Integrations
8. Appendix A — Database Schemas
9. Appendix B — JSON Schema Definitions
10. Appendix C — End-to-End Data Packet Trace ("The Pie Incident")

---

## MODULE 1: THE MONOLITHIC NARRATIVE ORCHESTRATOR (MNO)

The MNO is the single-writer authority over a Tenant's moral and social reality. It ingests raw player telemetry, resolves it against the Karma Vector, and emits **mutation events** consumed by the Dynamic Asset Pipeline and the Generative Quest Compile Framework. Think of it as a story engine with a message queue and a grudge.

### 1.1 Algorithmic Karma Engine

Every Tenant carries exactly one **Karma Vector**, a 2-axis floating point state clamped to `[-1000, 1000]` per axis:

| Axis | Range | -1000 Pole | +1000 Pole | Decay Rate |
|---|---|---|---|---|
| **Moral Axis (M)** | -1000 (Evil) to +1000 (Good) | "Butcher of Bowerstone" | "Saint of Albion" | 0.4% toward 0 per idle in-game hour |
| **Social Axis (S)** | -1000 (Corruption) to +1000 (Purity) | "Debauched Wretch" | "Paragon of Restraint" | 0.6% toward 0 per idle in-game hour |

Both axes decay toward neutral during idle time to simulate "the world moving on without you" — a deliberate design homage to the original trilogy's slow morph reversion, reimplemented here as a cron-scheduled Lambda (`karma-decay-tick`, fires every in-game hour, i.e. every 300 real-time seconds at default time-scale).

**Event scoring table** (subset — full table lives in `config/karma_weights.yaml`, 340 entries):

| Player Action (Telemetry Event) | ΔM | ΔS | Notes |
|---|---|---|---|
| `pie.steal` | -3 | -2 | Petty theft, low blast radius |
| `chicken.kick` | -1 | -4 | Almost pure Social-axis corruption; Albion takes poultry cruelty *very* seriously |
| `npc.kill.innocent` | -80 | -15 | Triggers immediate local mutation event |
| `npc.kill.bandit` | +12 | 0 | Justified violence does not corrupt |
| `gold.donate.temple` | +25 | +30 | Also queues a `micro_upsell.candle` prompt (see §5.3) |
| `marriage.propose.accept` | +5 | +10 | |
| `marriage.bigamy.discovered` | -10 | -60 | Social axis cratering is intentional; this is the funniest outcome in the franchise and we refuse to nerf it |
| `tavern.beer.consume` (per unit) | 0 | -3 | Volumetric, see Module 7 "Chicken Metric" pipeline |
| `quest.complete.good_path` | +40 | +5 | Scaled by `quest.tier` multiplier (1.0–4.5x) |
| `quest.complete.evil_path` | -40 | -5 | Same multiplier table |

**Real-time environment mutation formula.** On every scored event, the MNO computes a **Mutation Pressure** value `P`:

```
P = |ΔM_cumulative_7day| * 0.6 + |ΔS_cumulative_7day| * 0.4
```

When `P` crosses one of four thresholds (`150`, `400`, `700`, `1000`), the MNO emits a `world.mutation.trigger` event to the Dynamic Asset Pipeline, scoped to the Tenant's `region_id`. Mutation is **regional, not global** — corrupting Bowerstone does not sprout gargoyles in Oakvale. This is enforced by tagging every mutation event with the `region_id` of the triggering telemetry, read from the player's last known `world_position` snapshot.

### 1.2 Dynamic Asset Pipeline

On receipt of a `world.mutation.trigger`, an asynchronous serverless rendering fleet (auto-scaled AWS Lambda + on-demand GPU spot instances for LOD-0 detail passes) executes the **Morph Compositor**:

```
FUNCTION morph_compositor(tenant_id, region_id, karma_vector):
    player_mesh   = fetch_base_mesh(tenant_id)
    morph_target  = select_morph_lerp(karma_vector.M, karma_vector.S)
    // morph_target is a blend-shape weight set, not a discrete mesh swap
    apply_blendshapes(player_mesh, {
        horn_growth:      clamp((-karma_vector.M) / 1000, 0, 1),
        halo_intensity:   clamp(karma_vector.M / 1000, 0, 1),
        fly_swarm_density: clamp((-karma_vector.S) / 1000, 0, 1) * 12,   // max 12 flies
        glow_trail_alpha: clamp(karma_vector.M / 1000, 0, 1) * 0.8
    })
    render_lod_chain(player_mesh, lods=[0,1,2,3])
    push_to_cdn(tenant_id, cache_key=hash(karma_vector, region_id))
    invalidate_client_cache(tenant_id)   // WebSocket push, not poll
```

Environment assets (gargoyles, rot textures, crop blight) are handled by a parallel **Region Dressing Worker** that walks the `region_prop_manifest` table and swaps prop prefabs above the relevant mutation threshold — gargoyles begin sprouting on rooflines at `P >= 400` in Evil-leaning regions, local flora desaturates and wilts at `P >= 400` in Corruption-leaning regions, and at `P >= 1000` the region enters "Apex Mutation" state (permanent until karma reverses below threshold minus a 15% hysteresis band, to prevent flicker-morphing on borderline players).

All asset delivery is CDN-edge-cached per Tenant+region+threshold-tier, so no two players ever generate redundant render jobs for an identical morph state — a Tenant's personal descent into corruption is bespoke, but the *rendering* of "horns tier 3" is aggressively deduplicated. Damnation, it turns out, compresses beautifully.

### 1.3 Generative Quest Compile Framework

The Quest Compiler ingests the rolling 72-hour telemetry window for a Tenant and synthesizes bespoke quest chains via a template-grammar system (not free-form generation — Albion's writers insisted on a constrained grammar to preserve tone and prevent the AI from, in QA's words, "getting weird about the chickens").

**Pipeline:**

```
telemetry stream ──▶ Feature Extractor ──▶ Trope Matcher ──▶ Quest Assembler ──▶ VO Synthesis ──▶ Quest Ledger
```

1. **Feature Extractor** aggregates raw events into scored "player tendencies": `chicken_kicks_per_session`, `default_rate_on_loans`, `marriages_active`, `taverns_visited`, `bandits_slain`, etc.
2. **Trope Matcher** scores tendencies against ~180 seeded quest tropes (e.g. `TROPE_POULTRY_VENDETTA`, `TROPE_DEBT_COLLECTOR_REVENGE`, `TROPE_JILTED_SPOUSE`) and selects the top 3 by weighted relevance.
3. **Quest Assembler** instantiates the chosen trope's branching-tree template, filling slots with live world-state (actual NPC names, actual debts owed, actual chicken casualty counts) and auto-naming the quest via a Markov-chain title generator constrained to a "Fable-canon" corpus (results like *"The Forty-Second Chicken"* and *"A Gentleman's Arrears"* are typical, not cherry-picked).
4. **VO Synthesis** renders localized dialogue through a constrained TTS voice bank (12 base timbres × dialect morph × current NPC age-state), so a quest compiled at 3AM server time in a single Tenant still ships with fully voiced, fully localized dialogue before the player logs back in.
5. **Quest Ledger** commits the finished quest object to the Tenant's `active_quests` table and fires a `quest.available` push notification.

Example compiled quest object, generated from telemetry `"Kicked 42 chickens in 3 minutes"` + `"Defaulted on Bowerstone real estate loan"`:

```json
{
  "quest_id": "qc_9f21a7",
  "trope": "TROPE_POULTRY_VENDETTA_x_DEBT_COLLECTOR",
  "title": "The Forty-Second Chicken",
  "giver_npc_id": "npc_bowerstone_henwife_003",
  "compile_reason": ["chicken_kicks_per_session:42", "loan_default:bowerstone_east_12"],
  "stages": [
    {"id": 1, "goal": "Apologize to the Henwife (Good) OR Threaten the Henwife (Evil)"},
    {"id": 2, "goal": "Repay 220 gold to Bowerstone Trust OR Burn the loan ledger"},
    {"id": 3, "goal": "Branch resolves into 'Reformed Fowl-Friend' or 'Banned From Every Coop in Albion' title unlock"}
  ]
}
```

---

## MODULE 2: MULTI-TENANT WORLD TOPOLOGY & SHARDING

### 2.1 Tenant Separation Architecture

Each player is provisioned a **World Tenant**: a logically isolated Albion instance backed by row-level-security-scoped Postgres partitions (`tenant_id` as the partition key on every world-state table) plus a dedicated Redis namespace for hot-path state (position, inventory deltas, active combat). Tenants never share mutable world state directly — a bandit killed in Tenant A's forest is not dead in Tenant B's forest. What *is* shared is aggregate, anonymized telemetry, which flows one-way (Tenant → Mainnet) and never the reverse without going through the sync protocol in §2.2.

Isolation is enforced at three layers:
- **Data layer:** every table carries `tenant_id`; queries are auto-scoped by an ORM middleware that refuses to compile a query missing a tenant predicate.
- **Compute layer:** NPC daemons (Module 4) run as tenant-scoped goroutines within a shared worker pool, keyed `tenant_id:npc_id`, so a runaway daemon in one Tenant cannot starve another's simulation tick.
- **Render layer:** asset cache keys are namespaced by `tenant_id` for anything karma-dependent (per §1.2), but static geography meshes are shared read-only across all Tenants to avoid re-storing 40GB of Bowerstone cobblestone per player.

### 2.2 The Mainnet Overworld Sync

Once every real-world hour, a batch job (`mainnet-sync-aggregator`) rolls up anonymized, non-attributable summary statistics from every active Tenant into the **Mainnet Ledger**:

| Aggregated Signal | Source | Effect on Global Baseline |
|---|---|---|
| Mean regional gold velocity | BSE trade logs (§3.2) | Shifts global drop-rate table ±15% |
| Plague-vector incidence (sick NPC count / total NPC count) | NPC health daemon state | Raises/lowers global disease-spread coefficient |
| Bandit-camp respawn pressure | Combat telemetry | Adjusts baseline enemy density per region tier |
| Aggregate Karma skew (mean of all Tenant Moral Axis) | Karma Engine snapshots | Shifts the **Macro-Narrative Season** (see below) |

The Macro-Narrative Season is a server-wide flavor state — `Season: Harmony`, `Season: Rot`, `Season: Reckoning` — recalculated nightly from the aggregate Karma skew across the whole active player base. It never overrides a Tenant's local morph state; it only recolors ambient systems shared globally: weather palettes, background NPC barks, loading-screen flavor text, and the tint curve on the title screen. If the entire server population is, in aggregate, a pack of scoundrels, the sky over *everyone's* Albion gets a little more bruised.

### 2.3 Cross-Tenant Instancing (Co-Op Subscriptions)

When Tenant A invites Tenant B into a shared instance, the session provisions a **Merge Shard**: a short-lived, ephemeral world state that layers both Tenants' NPC-alive/dead ledgers using **host-authoritative canon resolution**:

```
FUNCTION resolve_npc_state(npc_id, host_tenant, guest_tenant):
    host_state  = host_tenant.npc_ledger[npc_id]
    guest_state = guest_tenant.npc_ledger[npc_id]

    IF host_state.alive != guest_state.alive:
        canon_state = host_state          // host Tenant's world is authoritative for the session
        guest_shadow_state = guest_state  // preserved, not discarded

    apply(canon_state, merge_shard)
    log_divergence(npc_id, host_state, guest_state, session_id)
```

The Host Tenant's world is canon for the duration of the co-op session — if Tenant A executed the Mayor of Bowerstone in Chapter 2, the Mayor is a corpse in the Merge Shard, full stop, and any quest that Tenant B's world would have routed through the (living) Mayor is automatically re-pathed by the Quest Compiler to the Mayor's `bloodline_successor` (see §4.2) for the session's duration. On session end, the Merge Shard is torn down; Guest Tenant B's own persistent world is entirely untouched — their Mayor is still very much alive, filing complaints about a stranger who showed up wearing his dead double's face for the afternoon. We have a bark line for that. Several, actually.

---

## MODULE 3: THE AUTOMATED MACRO-ECONOMY & FINTECH PIPELINE

### 3.1 Real-Estate Cron Jobs

Every owned property runs through a nightly batch (`property-tick`, cron `0 3 * * *` server time) that computes rent collection, degradation, and valuation:

```
rent_due        = base_rent * region_prosperity_index * (1 - tenant_relationship_score * 0.002)
degradation     = property.condition -= (2 + weather_severity_modifier)
                   // 0-100 scale; below 40 triggers "Squalid" listing tag, halves resale value
valuation_new   = (base_value * region_prosperity_index) - (degradation_penalty * 45)
```

Unpaid rent accrues a `late_fee` of 8% per missed cycle, compounding, and after 5 consecutive missed cycles the property is auto-repossessed and re-listed on the Bowerstone property market — with an outward webhook fired to the player's configured integrations (see §7.2: yes, this is the Slack-alert-on-default feature).

### 3.2 The Bowerstone Stock Exchange (BSE)

Raw material and consumable pricing runs on a live supply/demand curve, recalculated every 60 seconds across the **entire active cloud cluster** (not per-Tenant — the BSE is intentionally one of the few genuinely global, shared systems, representing "the Albion commodities market"):

```
price(t) = price(t-1) * (1 + elasticity * ((demand_60s - supply_60s) / (supply_60s + 1)))
```

| Commodity | Base Price (Gold) | Elasticity Coefficient | Notes |
|---|---|---|---|
| Tofu | 2g | 0.015 | Notoriously stable; nobody panics about tofu |
| Mutton | 6g | 0.04 | Spikes hard during in-game festival events |
| Masterwork Iron | 340g | 0.09 | High elasticity; blacksmith crafting spam moves this fast |
| Health Potion (Minor) | 12g | 0.11 | Correlates inversely with server-wide combat-death telemetry |
| Health Potion (Greater) | 85g | 0.06 | |

Price is floored at `0.35 * base_price` and ceilinged at `6.0 * base_price` to prevent a single whale Tenant from breaking the curve for the whole cluster. All BSE trades are logged to an immutable ledger table (`bse_trade_log`) that feeds directly into the Mainnet Sync gold-velocity signal from §2.2.

### 3.3 Algorithmic Inflation & Taxation Systems

Local tax collectors (a specialized NPC daemon subtype, see Module 4) recompute a Tenant's regional levy nightly:

```
wealth_index    = (liquid_gold + 0.6 * property_valuation + 0.3 * inventory_appraised_value)
tax_rate        = base_tax_rate + min(0.25, log10(max(wealth_index, 1)) * 0.03)
levy_due        = wealth_index * tax_rate * region_friction_multiplier
```

`region_friction_multiplier` ranges 0.8 (low-friction rural shires) to 1.6 (Bowerstone city core), and is deliberately engineered to maximize the classic Fable sensation of "I got rich and now everyone in a fancy hat is angry at me about it." Non-payment escalates through a 3-stage NPC daemon behavior shift: polite reminder bark → public shaming bark in town square → bounty issued on the player, routed through the standard bounty/wanted subsystem.

---

## MODULE 4: AUTONOMOUS AGENT (NPC) LIFECYCLE & STATE MACHINES

### 4.1 Persistent NPC Daemons

Every named NPC (roughly 4,200 unique named entities per fully-populated Tenant, deduplicated against the shared static roster where geography permits) runs as an independent finite-state-machine daemon on a 30-second heartbeat tick:

```
STATES: IDLE → WORKING → SOCIALIZING → COURTING → AGING_TICK → GRUDGE_EVALUATION → (loop)
```

Each tick, the daemon:
1. Advances `career_progress` toward the NPC's assigned career ladder (Villager → Apprentice → Tradesperson → Guildmaster, or the criminal-track equivalent).
2. Rolls a courtship check against nearby eligible NPC daemons using a compatibility score (shared `interest_tags`, proximity, and — critically — whether the player has meddled).
3. Applies an `age_tick` at a rate of roughly 1 in-game year per 6 real-time hours of Tenant uptime, adjusting appearance blendshapes and eventually rolling mortality checks past `age > elder_threshold`.
4. Evaluates its `memory_ledger` for unresolved grudges against the player and escalates behavior accordingly (cold greetings → refusal of service → bounty tip-offs to guards).

Memory is not decorative flavor text — it's a durable, append-only `npc_memory_ledger` row per interaction, weighted by `emotional_intensity` and subject to the same decay curve philosophy as Karma (grudges fade, slowly, unless reinforced).

### 4.2 The Bloodline Inheritance Vector

On an NPC's death (player-caused or natural), a `bloodline.succession` job fires:

```
FUNCTION process_succession(deceased_npc_id):
    estate       = fetch_estate(deceased_npc_id)
    heirs        = fetch_bloodline(deceased_npc_id, max_depth=3)
    successor    = select_heir(heirs, rule="eldest_living_by_default_unless_player_influenced")

    transfer(estate.property, TO=successor)
    transfer(estate.gold * 0.85, TO=successor)   // 15% "Bowerstone Estate Tax" — see §3.3, everything loops back to tax
    IF deceased_npc_id.cause_of_death == "player_assassination":
        successor.memory_ledger.append(GRUDGE, target=player_id, intensity=MAX)
        successor.behavior_flags.add("VENGEANCE_ARC_ELIGIBLE")
        quest_compiler.queue_trope("TROPE_BLOODLINE_VENGEANCE", npc=successor)
    IF NOT heirs:
        estate.property.status = "UNCLAIMED"
        estate.property.list_on_market = TRUE  // feeds directly back into §3.1
```

A murdered shopkeeper's resentful nephew inheriting the shop, quietly poisoning the player's reputation with every customer for the next forty hours of playtime, is not a scripted one-off — it's this function running exactly the same way it runs for all 4,200 NPCs.

### 4.3 Procedural Dialogue Compilation

NPC barks are generated on-demand (not pre-baked) by a pipeline that ingests `{current_world_state, player_karma_vector, npc_memory_ledger, local_events}` into a constrained dialogue-slot template, then routes the filled template through the same TTS voice bank described in §1.3. Barks are cached per unique `(npc_id, context_hash)` tuple for 24 hours to keep the TTS cluster from melting during peak concurrent hours, but the *context* — what the NPC actually has to say to you today — is computed fresh, meaning the same NPC genuinely says something different to a saintly player than to the horned, fly-swarmed nightmare who kicked her chicken forty-two times on a Tuesday.

---

## MODULE 5: SAAS MONETIZATION TIER MATRIX & COMPLIANCE

### 5.1 Tier Topology

| Tier | Price | Positioning |
|---|---|---|
| **Freemium Villager Tier** | $0/mo | Full Albion access, throttled simulation fidelity |
| **Standard Squire Tier** | $9.99/mo | Priority narrative processing, expanded companion behaviors |
| **Enterprise Archon Tier** | $29.99/mo | Maximum fidelity, background progression, full webhook suite |

### 5.2 Feature Matrix Mapping

| Feature | Freemium Villager | Standard Squire ($9.99) | Enterprise Archon ($29.99) |
|---|---|---|---|
| Background gold accrual (idle, per real-world hour) | 0.5 gold | 8 gold | 45 gold, compounding at 1.2%/day |
| MNO processing priority (quest-compile queue) | Standard queue (avg. 4hr compile latency) | Priority queue (avg. 12min) | Realtime lane (avg. 45sec, dedicated compute reservation) |
| Cosmetic asset compression fidelity | 512px textures, LOD-2 cap | 2K textures, LOD-1 cap | 4K textures, LOD-0, ray-traced halo/horn shaders |
| Companion dog behavior tier | Basic (fetch, bark) | Advanced (treasure-sniff, combat-assist) | Sentient-Adjacent (full NPC-daemon parity: the dog has a memory ledger and can hold a grudge against your enemies on your behalf) |
| Concurrent active quest-chains | 2 | 6 | Unlimited |
| Region mutation render latency | Up to 6hrs (batch render window) | ~20min | Near-instant (dedicated GPU spot reservation) |
| Cross-Tenant co-op invites/month | 1 | 10 | Unlimited |
| Webhook integrations (§7.2) | None | Slack only | Full suite (Slack, Jira, generic REST) |
| NPC memory ledger retention | 30 days rolling | 180 days | Permanent, immutable |

### 5.3 Micro-Transaction API Injections

The monetization layer listens on the same event bus as the MNO and fires contextual, real-time upsell prompts keyed off specific telemetry triggers — a design philosophy internally referred to (per the original creative brief) as "the pub always has one more round in it":

```
ON EVENT player.death:
    POST /billing/v1/proposals
    {
      "tenant_id": "...",
      "sku": "RESURRECTION_PHIAL",
      "price_usd": 0.99,
      "context": "death_event",
      "expiry_seconds": 45,           // urgency window while respawn-timer counts down
      "payment_method": "stored_default"
    }

ON EVENT gold.donate.temple:
    POST /billing/v1/proposals
    { "sku": "BLESSED_CANDLE_COSMETIC", "price_usd": 1.99, "context": "piety_moment" }

ON EVENT property.repossessed:
    POST /billing/v1/proposals
    { "sku": "EMERGENCY_RENT_COVERAGE", "price_usd": 4.99, "context": "financial_distress" }
```

All proposals are opt-in confirmation dialogs, never silent charges — a single explicit tap against the stored payment method is required, logged to `billing_consent_log` with a timestamp and the exact prompt copy shown, for compliance/chargeback purposes. Enterprise Archon subscribers receive a `micro_upsell.suppress_death_prompt` flag by default (their contract already covers a resurrection allowance), which is, thematically, the single funniest line item in the entire pricing sheet: you can pay enough money to Albion that Albion stops asking you to pay more money when you die.

---

## MODULE 6: CONTINUOUS INTEGRATION / CONTINUOUS GAMEPLAY (CI/CG)

### 6.1 Automated Content Deployment

Regional expansions and seasonal events ship through a blue/green world-geometry deployment pipeline: new region chunks are built, validated against a deterministic regression suite (physics collision integrity, NPC pathing graph connectivity, quest-graph reachability), and hot-swapped into the running world-mesh service behind a feature-flagged spatial boundary. Clients stream the new geometry via the same asset-delta mechanism used for karma-driven morphs (§1.2) — there is no "patch," there is only the world quietly becoming slightly different while you were in a tavern.

```
git push → CI: build region chunk → deterministic regression suite → canary Tenant pool (0.5%)
        → automated rollback trigger if canary crash-rate > 0.3% over 30min
        → progressive rollout (5% → 25% → 100% over 4hrs) → zero-downtime hot-swap
```

### 6.2 Algorithmic Balance Patching

A nightly analytics job (`balance-nightly`) aggregates weapon kill-velocity and spell mana-efficiency across the full active cluster and applies bounded auto-adjustments:

```
IF weapon.avg_time_to_kill < target_ttk * 0.85:
    weapon.damage_coefficient *= 0.97   // max 3% nightly nerf, prevents whiplash patches
IF spell.pick_rate < 0.02 AND spell.win_contribution < baseline * 0.7:
    spell.mana_cost *= 0.95             // max 5% nightly buff
```

Adjustments are capped per-night specifically to avoid the classic live-service failure mode of a weapon being "amazing, then garbage, then amazing" across three consecutive patches — Albion's balance daemon is deliberately slow and a little boring about this, which is more than can be said for anything else in the document.

---

## MODULE 7: TELEMETRY, ANALYTICS, AND WEBHOOK INTEGRATIONS

### 7.1 The "Chicken Metric" Pipeline

High-throughput, low-latency telemetry ingestion for the game's most sacred statistics runs through a dedicated Kafka topic (`albion.telemetry.absurd`, partitioned by `tenant_id`, retained 90 days) separate from core gameplay telemetry, because product analytics refused to let chicken-kick velocity distributions pollute the churn-prediction dataset:

| Metric | Type | Sample Rate |
|---|---|---|
| `chicken.kick.velocity_mps` | Float, per-event | 100% |
| `beer.volumetric_intake_ml` | Cumulative counter | 100% |
| `expressions.used_per_minute` | Rolling gauge | 10s window |
| `fart.emote.public_uses` | Counter | 100%, flagged for the "Reputation" leaderboards |
| `pie.theft.getaway_success_rate` | Ratio | Per-session rollup |

Aggregate leaderboards (`Fastest Chicken Kick — Global`, `Most Beer Consumed — Regional`) are recomputed hourly and are, per direct executive mandate, given equal architectural weight to the combat-DPS leaderboards. This was not up for debate during design review.

### 7.2 Enterprise Webhook System

Archon-tier Tenants may register outbound webhooks against a fixed catalog of world events, delivered as signed POST requests (HMAC-SHA256, `X-Albion-Signature` header) with at-least-once delivery and exponential backoff retry (up to 6 attempts over 24hrs):

| Event | Example Downstream Integration |
|---|---|
| `property.rent.defaulted` | Slack: *"⚠️ Bowerstone East Cottage #12 has defaulted on rent for the 3rd cycle. Repossession in 2 cycles."* |
| `monster.legendary.spawned` | Jira: auto-creates a ticket, `Priority: Blocker`, `Component: Player's Personal Forest`, assigned to the player's own account |
| `npc.bloodline.vengeance_arc_triggered` | Generic REST: fires to any configured endpoint with the full succession payload from §4.2 |
| `bse.commodity.price_ceiling_hit` | Slack: market alert, useful for Tenants running informal in-guild trading desks |
| `karma.threshold.crossed` | Generic REST: fires on entry into a new mutation tier, payload includes the full Karma Vector snapshot |

Webhook payloads are versioned (`schema_version` field) and documented in the public `docs/webhooks/` catalog (out of scope for this document), with a 99.95% delivery SLA backed by a dead-letter queue and a manual replay console for support staff.

---

## APPENDIX A: DATABASE SCHEMAS

### A.1 PostgreSQL — Core Player/World State (relational, strongly consistent)

```sql
CREATE TABLE tenants (
    tenant_id         UUID PRIMARY KEY,
    account_id        UUID NOT NULL REFERENCES accounts(account_id),
    subscription_tier VARCHAR(32) NOT NULL DEFAULT 'freemium_villager',
    world_seed        BIGINT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE karma_vectors (
    tenant_id     UUID PRIMARY KEY REFERENCES tenants(tenant_id),
    moral_axis    NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (moral_axis BETWEEN -1000 AND 1000),
    social_axis   NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (social_axis BETWEEN -1000 AND 1000),
    mutation_pressure NUMERIC(7,2) NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE properties (
    property_id       UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants(tenant_id),
    region_id         VARCHAR(64) NOT NULL,
    condition         SMALLINT NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
    valuation_gold    NUMERIC(12,2) NOT NULL,
    rent_due_gold     NUMERIC(12,2) NOT NULL DEFAULT 0,
    missed_cycles     SMALLINT NOT NULL DEFAULT 0,
    owner_npc_id      UUID REFERENCES npcs(npc_id),
    status            VARCHAR(24) NOT NULL DEFAULT 'occupied'  -- occupied|repossessed|unclaimed
);

CREATE TABLE npcs (
    npc_id            UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants(tenant_id),
    name              VARCHAR(128) NOT NULL,
    bloodline_root_id UUID,
    age_years         SMALLINT NOT NULL DEFAULT 0,
    career_stage      VARCHAR(32) NOT NULL DEFAULT 'villager',
    alive             BOOLEAN NOT NULL DEFAULT TRUE,
    fsm_state         VARCHAR(24) NOT NULL DEFAULT 'idle',
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE npc_memory_ledger (
    ledger_id         BIGSERIAL PRIMARY KEY,
    npc_id            UUID NOT NULL REFERENCES npcs(npc_id),
    subject_player_id UUID NOT NULL,
    memory_type       VARCHAR(24) NOT NULL,   -- grudge|fondness|debt|witness
    emotional_intensity SMALLINT NOT NULL CHECK (emotional_intensity BETWEEN 0 AND 100),
    context           JSONB NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bse_trade_log (
    trade_id      BIGSERIAL PRIMARY KEY,
    commodity     VARCHAR(48) NOT NULL,
    tenant_id     UUID NOT NULL,
    quantity      INTEGER NOT NULL,
    price_gold    NUMERIC(10,2) NOT NULL,
    side          VARCHAR(4) NOT NULL, -- buy|sell
    traded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (traded_at);
```

### A.2 NoSQL — Hot-Path & Telemetry State (DynamoDB / Redis, eventually consistent)

```
# DynamoDB: quest_ledger
PK: TENANT#<tenant_id>
SK: QUEST#<quest_id>
Attributes: { title, trope, giver_npc_id, compile_reason[], stages[], status, compiled_at }

# DynamoDB: active_mutation_state
PK: TENANT#<tenant_id>
SK: REGION#<region_id>
Attributes: { mutation_tier (0-4), last_render_hash, morph_weights{}, hysteresis_locked_until }

# Redis: hot position/combat state
KEY: pos:{tenant_id}          -> {x, y, z, region_id}, TTL 120s, refreshed on movement tick
KEY: combat:{tenant_id}       -> {in_combat, target_npc_id, aggro_table[]}, TTL 30s

# Kafka topic: albion.telemetry.absurd
Partition key: tenant_id
Payload: { event_type, tenant_id, value, unit, client_ts, server_ts }
```

---

## APPENDIX B: JSON SCHEMA DEFINITIONS

### B.1 NPC State Object

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "NPCStateObject",
  "type": "object",
  "required": ["npc_id", "tenant_id", "name", "alive", "fsm_state", "career_stage", "age_years", "memory_ledger"],
  "properties": {
    "npc_id":            { "type": "string", "format": "uuid" },
    "tenant_id":         { "type": "string", "format": "uuid" },
    "name":              { "type": "string", "maxLength": 128 },
    "bloodline_root_id": { "type": ["string", "null"], "format": "uuid" },
    "age_years":         { "type": "integer", "minimum": 0, "maximum": 130 },
    "career_stage":      { "type": "string", "enum": ["villager", "apprentice", "tradesperson", "guildmaster", "bandit", "brigand_captain"] },
    "alive":             { "type": "boolean" },
    "cause_of_death":    { "type": ["string", "null"], "enum": [null, "player_assassination", "old_age", "plague", "bandit_raid"] },
    "fsm_state":          { "type": "string", "enum": ["idle", "working", "socializing", "courting", "aging_tick", "grudge_evaluation"] },
    "behavior_flags":    { "type": "array", "items": { "type": "string" } },
    "memory_ledger": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["subject_player_id", "memory_type", "emotional_intensity", "created_at"],
        "properties": {
          "subject_player_id":   { "type": "string", "format": "uuid" },
          "memory_type":         { "type": "string", "enum": ["grudge", "fondness", "debt", "witness"] },
          "emotional_intensity": { "type": "integer", "minimum": 0, "maximum": 100 },
          "context":             { "type": "object" },
          "created_at":          { "type": "string", "format": "date-time" }
        }
      }
    },
    "last_heartbeat_at": { "type": "string", "format": "date-time" }
  }
}
```

### B.2 Player Karma Vector Object

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PlayerKarmaVectorObject",
  "type": "object",
  "required": ["tenant_id", "moral_axis", "social_axis", "mutation_pressure", "updated_at"],
  "properties": {
    "tenant_id":         { "type": "string", "format": "uuid" },
    "moral_axis":        { "type": "number", "minimum": -1000, "maximum": 1000 },
    "social_axis":       { "type": "number", "minimum": -1000, "maximum": 1000 },
    "mutation_pressure": { "type": "number", "minimum": 0 },
    "active_mutation_tier": { "type": "integer", "minimum": 0, "maximum": 4 },
    "morph_weights": {
      "type": "object",
      "properties": {
        "horn_growth":       { "type": "number", "minimum": 0, "maximum": 1 },
        "halo_intensity":    { "type": "number", "minimum": 0, "maximum": 1 },
        "fly_swarm_density": { "type": "number", "minimum": 0, "maximum": 12 },
        "glow_trail_alpha":  { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "macro_season": { "type": "string", "enum": ["harmony", "rot", "reckoning"] },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

---

## APPENDIX C: END-TO-END DATA PACKET TRACE — "THE PIE INCIDENT"

Trace of a single player action, from client input to full-system settlement:

```
[CLIENT]
   Player presses "steal" on a market stall pie.
        │
        ▼
[EDGE GATEWAY]  (WebSocket, auth-scoped to tenant_id)
   Validates session token, rate-limits (max 20 actions/sec/tenant), forwards
   action_event { type: "pie.steal", tenant_id, npc_witness_ids[], world_position }
        │
        ▼
[GAME STATE SERVICE]
   Applies inventory delta (pie: +1), checks witness NPCs in proximity radius.
   Emits two parallel events onto the internal bus:
        │
        ├──────────────────────────────┐
        ▼                              ▼
[MNO: KARMA ENGINE]             [NPC DAEMON: witness_npc]
   ΔM -3, ΔS -2 applied to         fsm_state → GRUDGE_EVALUATION
   karma_vectors row (Postgres,    memory_ledger.append({
   tenant-scoped UPDATE)             memory_type: "witness",
   mutation_pressure recalculated    emotional_intensity: 22
        │                            })
        ▼                              │
   IF threshold crossed:               ▼
   emit world.mutation.trigger    [BOUNTY SUBSYSTEM]
        │                          IF emotional_intensity > threshold:
        ▼                          issue bounty_flag, notify nearby guard NPC daemons
[DYNAMIC ASSET PIPELINE]
   Serverless morph_compositor (if threshold crossed)
   renders updated blendshapes, pushes to CDN, invalidates client cache
        │
        ▼
[TELEMETRY BUS]  (Kafka: albion.telemetry.absurd + core gameplay topic)
   pie.theft.getaway_success_rate updated
   feeds Quest Compiler's 72hr rolling feature window (§1.3)
        │
        ▼
[MAINNET SYNC — hourly batch, not per-event]
   Aggregates into region-level "petty crime index," nudges global
   drop-rate table and Macro-Narrative Season on next nightly recompute
        │
        ▼
[CLIENT]
   WebSocket push: inventory updated, nearby NPC bark queued
   ("Oi! That's my pie!"), HUD karma nudge animation plays
```

Total round-trip, stolen-pie-to-visible-consequence: under 250ms for the immediate reaction; up to several hours for the slow-burn systemic consequences (mutation render batching, quest compilation, mainnet macro-season drift) — because the best part of a Fable game was never the pie. It was finding out, three hours later, that the pie mattered.

---

*End of document. Filed under: `docs/FABLE5_ALBION_AAAS_ARCHITECTURE.md`. All formulas, schemas, and thresholds in this document are production-parameter placeholders in the sense that every enterprise architecture document's numbers are placeholders — which is to say, treat them as load-bearing until a designer tells you otherwise.*
