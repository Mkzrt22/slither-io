# Lucky Dungeon Tycoon — Core Architecture

Framework-agnostic TypeScript core for a single-screen mobile idle game,
structured along Clean Architecture lines: pure domain types at the centre,
stateless engines around them, and infrastructure (storage, ad/IAP bridges,
UI event bus) at the edge. No module imports anything from a view layer.

## Modules (`src/`)

| File | Layer | Responsibility |
| --- | --- | --- |
| `types.ts` | Domain | `UserProfile`, `SpinResult`, `GameConfig`, profile factory/clone helpers. Zero dependencies. |
| `EconomyEngine.ts` | Domain service | Geometric upgrade-cost and gain curves; short-scale currency formatter (K…Dc, scientific fallback). |
| `GameStateManager.ts` | Infrastructure | localStorage persistence (in-memory fallback), offline energy regen, 4-hour offline raid determinator, anti-tamper sanitisation of loaded state. |
| `SpinEngine.ts` | Domain service | Energy-gated weighted-random spin loop (50/25/15/10 reward table) with deterministic roll injection for tests. |
| `MonetizationBridge.ts` | Infrastructure | Mock rewarded-ad gateway (1s latency, 95% fill) and gem→energy IAP with non-mutating purchase semantics. |
| `EventBus.ts` | Infrastructure | Type-safe pub/sub (`state:updated`, `spin:result`, `ui:popup_energy`, `ui:notification`) decoupling model from view. |
| `GameController.ts` | Application | Orchestrates the engines into use cases (spin, upgrade, buy energy, watch ad), live energy regen loop, offline-log replay; publishes every transition on the bus. |

## View layer (`web/`)

`web/index.html` + `web/main.ts` form a single-screen browser UI that talks
to the model exclusively through `GameController` and the EventBus — no game
rules live in the view. Run it with:

```sh
npm run serve:web   # builds and serves http://localhost:8080/web/
```

## Verifying

```sh
npm install
npm run typecheck   # strict-mode compile, no emit
npm test            # 49 unit tests on Node's built-in test runner
```

Compiles clean under `strict: true`. The test suite (`tests/core.test.ts`)
covers the economy curves, every formatter tier and degenerate input, all
spin-band boundaries, raid/shield offline outcomes, anti-tamper state
sanitisation, monetization paths, and EventBus delivery semantics — all
deterministic via the injectable RNG and roll parameters.
