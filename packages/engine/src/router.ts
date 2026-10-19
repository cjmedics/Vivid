import type { Capability, MicroUsd, ModelTier, PlanDefinition, Resolution, Shot } from "@vivid/core";
import { attemptCost } from "./providers/catalog.js";
import type { ModelSpec, ProviderId } from "./providers/types.js";
import type { ModelTelemetry } from "./telemetry.js";

/**
 * Execution router (cost doc §4, §15, §19):
 *   1. deterministic first — never pay a video model for what Remotion can do
 *   2. first tier (efficient → balanced → premium) that can satisfy the shot
 *   3. within a tier, lowest effective cost per accepted second
 *   4. premium only with a justification and a plan that allows it
 *   5. the rest of the tier, then higher tiers, form the fallback/escalation chain
 */

const TIER_ORDER: ModelTier[] = ["efficient", "balanced", "premium"];

export interface RouteContext {
  plan: PlanDefinition;
  resolution: Resolution;
  catalog: ModelSpec[];
  telemetry: ModelTelemetry;
  /** Providers with a configured adapter right now. */
  availableProviders: ReadonlySet<ProviderId>;
}

export interface RouteCandidate {
  model: ModelSpec;
  costPerAttempt: MicroUsd;
  acceptanceRate: number;
  /** costPerAttempt / acceptanceRate — what an accepted shot is expected to cost. */
  expectedCost: MicroUsd;
  effectivePerAcceptedSec: MicroUsd;
}

export type Route =
  | { kind: "deterministic"; shotId: string }
  | { kind: "generate"; shotId: string; tier: ModelTier; primary: RouteCandidate; chain: RouteCandidate[]; reason: string };

export class NoRouteError extends Error {
  constructor(
    readonly shotId: string,
    readonly rejections: string[],
  ) {
    super(`No qualifying model for shot ${shotId}: ${rejections.join("; ")}`);
  }
}

export function routeShot(shot: Shot, ctx: RouteContext): Route {
  if (shot.mode === "deterministic" || !shot.generation) return { kind: "deterministic", shotId: shot.id };

  const gen = shot.generation;
  const required: Capability[] = [...gen.capabilities, ...(gen.audio ? (["audio"] as Capability[]) : [])];
  const premiumAllowed = ctx.plan.premiumRouting && gen.premiumJustification !== undefined;
  const startTier = TIER_ORDER.indexOf(gen.minTier);
  const rejections: string[] = [];

  const byTier = new Map<ModelTier, RouteCandidate[]>();
  for (const model of ctx.catalog) {
    const why = disqualify(model, { required, ctx, durationSec: gen.durationSec, startTier, premiumAllowed });
    if (why) {
      rejections.push(`${model.key}: ${why}`);
      continue;
    }
    const costPerAttempt = attemptCost(model, ctx.resolution, gen.durationSec, gen.audio);
    const acceptanceRate = ctx.telemetry.acceptanceRate(model.key, model.tier);
    const expectedCost = Math.round(costPerAttempt / acceptanceRate);
    const candidate: RouteCandidate = {
      model,
      costPerAttempt,
      acceptanceRate,
      expectedCost,
      effectivePerAcceptedSec: Math.round(expectedCost / gen.durationSec),
    };
    byTier.set(model.tier, [...(byTier.get(model.tier) ?? []), candidate]);
  }

  const ordered = TIER_ORDER.flatMap((tier) =>
    (byTier.get(tier) ?? []).sort((a, b) => a.effectivePerAcceptedSec - b.effectivePerAcceptedSec || a.model.key.localeCompare(b.model.key)),
  );
  const [primary, ...rest] = ordered;
  if (!primary) throw new NoRouteError(shot.id, rejections);

  return {
    kind: "generate",
    shotId: shot.id,
    tier: primary.model.tier,
    primary,
    chain: rest,
    reason:
      primary.model.tier === "premium"
        ? `premium justified by ${gen.premiumJustification}`
        : `cheapest qualifying ${primary.model.tier} model by cost per accepted second`,
  };
}

function disqualify(
  model: ModelSpec,
  q: { required: Capability[]; ctx: RouteContext; durationSec: number; startTier: number; premiumAllowed: boolean },
): string | null {
  if (!q.ctx.availableProviders.has(model.providerId)) return "provider not configured";
  if (TIER_ORDER.indexOf(model.tier) < q.startTier) return "below minimum tier";
  if (model.tier === "premium" && !q.premiumAllowed) return "premium not justified or not in plan";
  const missing = q.required.filter((c) => !model.capabilities.includes(c));
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  if (!model.resolutions.includes(q.ctx.resolution)) return `no ${q.ctx.resolution}`;
  if (model.maxDurationSec < q.durationSec) return `max ${model.maxDurationSec}s`;
  return null;
}
