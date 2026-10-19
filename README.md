# Vivid

AI-native product video engine. Deterministic Remotion rendering first; generative video models only for the shots that need them. Pricing is an output of the same `ShotPlan` the renderer consumes.

```
npm install
npm test                 # 27 tests: routing, estimator, executor, ledger, presets, OpenRouter adapter
npm run typecheck
npm run demo             # plan → estimate → execute (mock providers) → cost + margin report
npm run demo -- --style cinematic --plan studio
npm run demo -- --outage # OpenRouter down → router falls back to Higgsfield
npm run render:demo      # writes out/demo.mp4 via Remotion
npm run studio           # Remotion Studio
```

## Layout

| Package | Role |
|---|---|
| `packages/core` | Zod schemas and shared constants: `ShotPlan`, Product IR, motion library, plans (USD), money (integer micro-USD) |
| `packages/engine` | Provider catalog + adapters, router, estimator, ledger, executor, presets |
| `packages/renderer` | Remotion composition that renders a `ShotPlan` |
| `apps/demo` | End-to-end walkthrough on mock providers |

## Decisions encoded

- **Pricing (USD):** Starter $39 / 10 BM / 20 RU · Pro $119 / 35 BM / 60 RU · Studio $299 / 100 BM / 200 RU.
- **Provider prices** in `engine/src/providers/catalog.ts` are non-promotional, dated 2026-09-26, and `verified: false` until synced from each provider's discovery API.
- **Margin guard:** Build Minutes charged = `max(formula, internal cost ÷ $1.25)`. Premium-heavy work consumes more minutes instead of eating margin. Refinement Units get the same floor (`$0.15`/RU).
- **Routing:** deterministic first → cheapest tier that qualifies, ranked by cost per *accepted* second (price ÷ acceptance rate) → fallbacks → escalation. Premium needs a plan that allows it plus a justification on the shot.
- **Failed productions charge nothing.** Provider spend is still recorded.

## Not built yet

Browser capture / Figma ingestion, the LLM planner (presets are rule-based today), Cloudflare Workers/Workflows/Queues wiring, Postgres ledger (must match `InMemoryLedger` semantics), billing, auth, web UI, real quality validators, Higgsfield adapter, and syncing the catalog from live provider APIs.
