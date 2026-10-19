# AI-assisted choreography and copy

This milestone adds two bounded model roles to the existing Figma/screenshot pipeline:
choreography selection and copy suggestions. Their providers and models can differ.
The renderer, brand assets, geometry and motion implementation stay application-owned.
No video-generation model calls are made by this path.

## Modes and evidence

| Mode | Behavior | Validation evidence |
| --- | --- | --- |
| Rules (default) | Existing heuristic ordering and supplied copy | Unit/CLI tests and hosted render |
| Live | Up to one request for choreography and one for copy | Request/response contract tests with mocks; needs an API key for live validation |
| Replay | Compile saved, reviewed suggestions without a model call | CLI tests and hosted render |

`fixtures/planner.suggestions.json` is hand-authored demonstration data. Rendering it
proves the selection/compiler/review workflow, not that a live model produced the
choices or that a provider account has access to the configured model.

## Run the replay demo

```bash
npm ci
npm run create:planned-sample -- --render
```

The sample reorders the three design cards, uses slide transitions, and applies
reviewed copy. It writes to `out/planned-sample/`. Use a new `--out` directory for
subsequent runs; existing output directories are never overwritten.

## Enable live planning

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment or untracked `.env`.
Figma credentials are separate and unnecessary for an offline export or annotated
screenshot. Missing planner keys fail before any live Figma API requests.

```bash
# Existing sample input, but real paid planning calls; supplied copy remains in the video.
npm run create:sample -- --out out/openai-review \
  --planner openai --planner-model gpt-5.5 \
  --direction 'Lead with the launch card, then show planning and teamwork.'

# Configure different providers/models for the two roles (requires both keys).
npm run create:sample -- --out out/mixed-review \
  --planner openai --planner-model gpt-5.5 \
  --copy-provider anthropic --copy-model claude-haiku-4-5
```

The same options apply to the live-Figma or screenshot commands documented in
[Figma ingestion](figma-ingestion.md). Add `--render` to render with the chosen
choreography while retaining original copy for the first review.

| Setting | Default |
| --- | --- |
| `--planner` | `rules`; opt into `openai` or `anthropic` |
| `--planner-model` / `OPENAI_PLANNER_MODEL` | `gpt-5.5` for OpenAI |
| `--planner-model` / `ANTHROPIC_PLANNER_MODEL` | `claude-sonnet-5` for Anthropic |
| `--copy-provider` | The choreography provider |
| `--copy-model` / `OPENAI_COPY_MODEL` | Selected OpenAI choreography model, or `gpt-5.5` when switching providers |
| `--copy-model` / `ANTHROPIC_COPY_MODEL` | `claude-haiku-4-5` |
| `--planner-max-output` | 2048 output tokens per request; allowed range 256–8192 |

These IDs are configuration defaults, not a claim that they are the cheapest, best,
or enabled on every account. Override them to use an accessible model supporting the
provider's structured-output endpoint. GPT-5.5 alias/snapshot requests use low reasoning
effort; other model IDs retain their provider defaults.

## Review and accept copy

Live planning saves `planning.json` and `planner-suggestions.json`. The first holds
role-level source, provider/model, token/cache usage where reported, outcome, and the
original/final copy. The second contains the compact recipe and proposed copy.

Review the wording and scene choices, then reuse the same original design input:

```bash
npm run create:sample -- --out out/approved-video \
  --planner-replay out/openai-review/planner-suggestions.json \
  --accept-copy --render
```

`--accept-copy` requires replay. It cannot silently accept unseen copy from a live
request. Replay invokes the same reference and copy validators and makes no new
model call. Preserve supplied copy by omitting `--accept-copy`. Replay files can be
edited before acceptance; they must contain `choreography` and optional `copy` only.
Use the original input and brand files so the references still identify the same design.

## Compiler and validation boundaries

The choreography response selects one supplied screen, up to three distinct region
IDs, typography and transition enums, and bounded timing values. It is never a raw
ShotPlan or executable code. Only the application can populate exact assets, positions,
brand tokens, output policy, and supported primitives. Explicit `--pacing` overrides
remain authoritative. Unknown IDs, duplicate targets, unsupported primitives, extra
fields, and out-of-bounds timing reject that role's response and use the rules fallback.

Copy must fit existing slot limits and cite supplied brief/copy evidence IDs. A small
numeric-claim check rejects new digits absent from cited evidence. Evidence IDs and
that check are not a factual-entailment test: invented qualitative claims, written-out
numbers, or misleading context still need human review. Models receive structured
product metadata and a bounded selection of region names/boxes, not screenshot bytes,
brand assets, source URLs, API keys, or an unbounded Figma document. This release does
not add visual understanding or autonomous access to tools.

## Failure handling, usage and costs

- One request per role, no automatic retries or model escalation; 60-second request
  timeout. Refusals skip the second role. Network/HTTP failure skips the next role
  on the same provider. Different configured providers remain explicit role choices.
- Failed/invalid choreography falls back to the deterministic recipe. Invalid copy
  retains the original. The audit distinguishes model, replay, rules, fallback and
  skipped outcomes; no failure is represented as a successful AI result.
- Available usage is retained even when content is rejected or truncated. Raw error
  bodies and credentials are not printed or saved in the audit. A failed request with
  missing usage may still have incurred provider spend.
- Token usage is not yet converted to verified dollars. `estimate.json` marks planning
  cost as a configured placeholder and live planning as needing cost reconciliation.
  Its existing internal planning allowance is not a measured API cost or spending cap.
  Model API charges can occur before the render quote, even when rendering is skipped.
- Anthropic requests mark the stable system prompt for ephemeral caching. OpenAI
  returns cache usage when available. Neither guarantees a cache hit; provider minimum
  prefix lengths and policies apply.
- The local command never charges Vivid account credits. Production billing, hard
  dollar budgets, durable jobs, and settlement after final export remain future work.

## Provider references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/overview)
