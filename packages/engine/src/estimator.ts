import {
  assertPlanAllows,
  generativeSeconds,
  outputResolution,
  planDurationSec,
  type MicroUsd,
  type PlanDefinition,
  type Resolution,
  type Shot,
  type ShotPlan,
} from "@vivid/core";
import { DEFAULT_COST_MODEL, intensityMultiplier, type CostModel } from "./costs.js";
import { routeShot, type Route, type RouteContext } from "./router.js";

/**
 * Pre-execution estimate (cost doc §7, §15 rule 6, §21). Consumes the same ShotPlan
 * the renderer uses, so the price shown is derived from what will actually be produced.
 */

export interface ProductionEstimate {
  planId: string;
  resolution: Resolution;
  durationSec: number;
  deterministicSec: number;
  generativeSec: number;
  deterministicShare: number;
  shotCount: number;
  multipliers: { quality: number; intensity: number; complexity: number };
  /** duration/60 × quality × intensity × complexity */
  formulaBuildMinutes: number;
  /** internal cost / targetCostPerBuildMinute */
  costFloorBuildMinutes: number;
  /** What the customer is charged: max of the two, rounded up to 0.1. */
  buildMinutes: number;
  chargeBasis: "formula" | "cost-floor";
  /** Refinements a production like this typically needs; shown to the user, not held. */
  refinementUnitsSuggested: number;
  internal: {
    generation: MicroUsd;
    expectedRetries: MicroUsd;
    planning: MicroUsd;
    browser: MicroUsd;
    rendering: MicroUsd;
    storage: MicroUsd;
    total: MicroUsd;
    perAcceptedSecond: MicroUsd;
  };
  routes: Route[];
}

export interface EstimateInput {
  plan: ShotPlan;
  account: PlanDefinition;
  route: Omit<RouteContext, "plan" | "resolution">;
  costModel?: CostModel;
}

export function estimateProduction({ plan, account, route, costModel = DEFAULT_COST_MODEL }: EstimateInput): ProductionEstimate {
  assertPlanAllows(account, plan.quality, plan.aspectRatio);
  const resolution = outputResolution(account, plan.quality);
  const ctx: RouteContext = { ...route, plan: account, resolution };

  const durationSec = planDurationSec(plan);
  const generativeSec = generativeSeconds(plan);
  const generativeShare = durationSec > 0 ? generativeSec / durationSec : 0;

  const routes = plan.shots.map((shot) => routeShot(shot, ctx));
  let generation = 0;
  let expectedRetries = 0;
  for (const r of routes) {
    if (r.kind !== "generate") continue;
    generation += r.primary.costPerAttempt;
    expectedRetries += r.primary.expectedCost - r.primary.costPerAttempt;
  }

  const rendering = costModel.renderLicensePerRender + Math.round(costModel.renderComputePerMinute * (durationSec / 60));
  const fixed = costModel.planningPerProduction + costModel.browserPerProduction + rendering + costModel.storagePerProduction;
  const total = generation + expectedRetries + fixed;

  const multipliers = {
    quality: costModel.qualityMultiplier[resolution],
    intensity: intensityMultiplier(generativeShare),
    complexity: complexityMultiplier(plan.shots),
  };
  const formulaBuildMinutes = (durationSec / 60) * multipliers.quality * multipliers.intensity * multipliers.complexity;
  const costFloorBuildMinutes = total / costModel.targetCostPerBuildMinute;
  const chargeBasis = costFloorBuildMinutes > formulaBuildMinutes ? "cost-floor" : "formula";

  return {
    planId: plan.id,
    resolution,
    durationSec,
    deterministicSec: durationSec - generativeSec,
    generativeSec,
    deterministicShare: durationSec > 0 ? 1 - generativeShare : 1,
    shotCount: plan.shots.length,
    multipliers,
    formulaBuildMinutes,
    costFloorBuildMinutes,
    buildMinutes: roundUpTenth(Math.max(formulaBuildMinutes, costFloorBuildMinutes)),
    chargeBasis,
    refinementUnitsSuggested: Math.ceil(plan.shots.length / 4),
    internal: {
      generation,
      expectedRetries,
      planning: costModel.planningPerProduction,
      browser: costModel.browserPerProduction,
      rendering,
      storage: costModel.storagePerProduction,
      total,
      perAcceptedSecond: durationSec > 0 ? Math.round(total / durationSec) : 0,
    },
    routes,
  };
}

/** Reference-driven and video-input shots are harder to land; each adds 10%, capped at 1.3. */
function complexityMultiplier(shots: Shot[]): number {
  const hard = shots.filter((s) =>
    s.generation?.capabilities.some((c) => c === "reference-to-video" || c === "video-input" || c === "motion-transfer"),
  ).length;
  return Math.min(1 + 0.1 * hard, 1.3);
}

export function roundUpTenth(n: number): number {
  // Subtract a hair so 0.8000000001 from float math doesn't round up to 0.9.
  return Math.ceil(n * 10 - 1e-9) / 10;
}
