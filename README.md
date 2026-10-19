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
npm run create:sample -- --render  # offline Figma-shaped fixture → real image → MP4
npm run create:planned-sample -- --render # reviewed choreography/copy replay → MP4 (no model calls)
```

## Layout

| Package | Role |
|---|---|
| `packages/core` | Zod schemas and shared constants: `ShotPlan`, Product IR, motion library, plans (USD), money (integer micro-USD) |
| `packages/engine` | Provider catalog + adapters, router, estimator, ledger, executor, presets |
| `packages/renderer` | Remotion composition that renders a `ShotPlan` |
| `apps/demo` | End-to-end walkthrough on mock providers |
| `apps/create` | Figma frame or annotated screenshot + brand kit + brief → quote and render |

## Figma-to-video milestone

The new `design-reveal` preset imports a selected Figma frame with its layer geometry,
renders the exported PNG with deterministic camera moves and region highlights, and
uses explicit brand/copy inputs. It never simulates changed product values or clicks.
The default export is 16:9; the account plan caps resolution. Frame images are
embedded in the plan so expiring Figma image URLs cannot break later renders.

See [Figma ingestion](docs/figma-ingestion.md) for live access, offline snapshots,
brand assets, screenshot fallback, and current limitations. The checked-in sample is
a purpose-built fixture, not a live customer Figma import. Live account access still
needs an authorized frame link and `FIGMA_ACCESS_TOKEN`.

## AI choreography and copy

Optional OpenAI Responses and Anthropic Messages adapters select a bounded motion
recipe and draft copy. The application compiles that recipe into a validated
ShotPlan; models cannot replace assets, branding, coordinates, or generation routes.
Rules remain the default. Failed or invalid model output falls back to the existing
deterministic plan, with usage and failure details retained for review. Copy is saved
as a suggestion and accepted through a separate, token-free replay command.

See [AI planning](docs/ai-planning.md) for provider configuration, role/model choices,
review, request limits, audit output, and the distinction between contract-tested
adapters, hand-authored replay fixtures, and live account validation.

## Decisions encoded

- **Pricing (USD):** Starter $39 / 10 BM / 20 RU · Pro $119 / 35 BM / 60 RU · Studio $299 / 100 BM / 200 RU.
- **Provider prices** in `engine/src/providers/catalog.ts` are non-promotional, dated 2026-09-26, and `verified: false` until synced from each provider's discovery API.
- **Margin guard:** Build Minutes charged = `max(formula, internal cost ÷ $1.25)`. Premium-heavy work consumes more minutes instead of eating margin. Refinement Units get the same floor (`$0.15`/RU).
- **Routing:** deterministic first → cheapest tier that qualifies, ranked by cost per *accepted* second (price ÷ acceptance rate) → fallbacks → escalation. Premium needs a plan that allows it plus a justification on the shot.
- **Failed productions charge nothing.** Provider spend is still recorded.

## Not built yet

Browser capture, multimodal screenshot understanding, live planner account validation and quality/cost evaluation, Cloudflare Workers/Workflows/Queues wiring, Postgres ledger (must match `InMemoryLedger` semantics), billing, auth, web UI, real quality validators, Higgsfield adapter, and syncing the catalog from live provider APIs. The create command saves local estimates and render status; it does not charge customer usage or replace the production billing lifecycle.
