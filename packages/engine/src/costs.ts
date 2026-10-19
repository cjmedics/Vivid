import { usd, type MicroUsd, type Resolution } from "@vivid/core";

/**
 * Internal cost model (cost doc §6, §16–17). Planning assumptions — replace with
 * production telemetry once real jobs run.
 */
export interface CostModel {
  planningPerProduction: MicroUsd;
  browserPerProduction: MicroUsd;
  /** Remotion Automators license fee per render. */
  renderLicensePerRender: MicroUsd;
  renderComputePerMinute: MicroUsd;
  storagePerProduction: MicroUsd;
  /**
   * Internal cost one Build Minute is allowed to absorb. If a production costs more,
   * it consumes more Build Minutes — this is the margin guard for premium/cinematic work.
   */
  targetCostPerBuildMinute: MicroUsd;
  /** Same guard for refinements. */
  targetCostPerRefinementUnit: MicroUsd;
  qualityMultiplier: Record<Resolution, number>;
}

export const DEFAULT_COST_MODEL: CostModel = {
  planningPerProduction: usd(0.03),
  browserPerProduction: usd(0.02),
  renderLicensePerRender: usd(0.01),
  renderComputePerMinute: usd(0.01),
  storagePerProduction: usd(0.01),
  targetCostPerBuildMinute: usd(1.25),
  targetCostPerRefinementUnit: usd(0.15),
  qualityMultiplier: { "480p": 1.0, "720p": 1.0, "1080p": 1.25, "4k": 1.6 },
};

/** Generation intensity from the share of the video that is generated (cost doc §7). */
export function intensityMultiplier(generativeShare: number): number {
  if (generativeShare <= 0.25) return 1.0;
  if (generativeShare <= 0.5) return 1.25;
  return 1.5;
}
