import { outputResolution, type MicroUsd, type PlanDefinition, type QualityMode, type Shot } from "@vivid/core";
import { DEFAULT_COST_MODEL, type CostModel } from "./costs.js";
import { routeShot, type RouteContext } from "./router.js";

/**
 * Refinement Units (cost doc §8). Base units by change class, raised when the affected
 * shots are expensive to regenerate — the doc's envelope doesn't cover this cost otherwise.
 */

export type RefinementKind = "minor" | "shot" | "major" | "structural";

export const REFINEMENT_BASE_UNITS: Record<RefinementKind, number> = {
  minor: 1,
  shot: 2,
  major: 3,
  structural: 5,
};

export interface RefinementQuote {
  kind: RefinementKind;
  units: number;
  internalCost: MicroUsd;
  affectedShotIds: string[];
  chargeBasis: "base" | "cost-floor";
}

export function quoteRefinement(input: {
  kind: RefinementKind;
  affectedShots: Shot[];
  account: PlanDefinition;
  quality: QualityMode;
  route: Omit<RouteContext, "plan" | "resolution">;
  costModel?: CostModel;
}): RefinementQuote {
  const costModel = input.costModel ?? DEFAULT_COST_MODEL;
  const ctx: RouteContext = { ...input.route, plan: input.account, resolution: outputResolution(input.account, input.quality) };

  let internalCost = costModel.renderLicensePerRender;
  for (const shot of input.affectedShots) {
    const r = routeShot(shot, ctx);
    if (r.kind === "generate") internalCost += r.primary.expectedCost;
  }

  const base = REFINEMENT_BASE_UNITS[input.kind];
  const floor = Math.ceil(internalCost / costModel.targetCostPerRefinementUnit);
  return {
    kind: input.kind,
    units: Math.max(base, floor),
    internalCost,
    affectedShotIds: input.affectedShots.map((s) => s.id),
    chargeBasis: floor > base ? "cost-floor" : "base",
  };
}
