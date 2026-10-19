import type { MicroUsd, ModelTier } from "@vivid/core";

/**
 * Per-model acceptance telemetry (cost doc §5). Acceptance rates are what turn a cheap
 * per-second price into an expensive per-accepted-second price.
 */

export interface ModelStats {
  calls: number;
  accepted: number;
  generatedSec: number;
  spend: MicroUsd;
}

/** Planning priors until real production telemetry replaces them. */
export const ACCEPTANCE_PRIOR: Record<ModelTier, number> = {
  efficient: 0.75,
  balanced: 0.85,
  premium: 0.9,
};

/** Weight of the prior in pseudo-observations; real data dominates after a few dozen calls. */
const PRIOR_WEIGHT = 8;

export class ModelTelemetry {
  private stats = new Map<string, ModelStats>();

  record(modelKey: string, outcome: { accepted: boolean; generatedSec: number; spend: MicroUsd }): void {
    const s = this.get(modelKey);
    s.calls += 1;
    if (outcome.accepted) s.accepted += 1;
    s.generatedSec += outcome.generatedSec;
    s.spend += outcome.spend;
    this.stats.set(modelKey, s);
  }

  get(modelKey: string): ModelStats {
    return { ...(this.stats.get(modelKey) ?? { calls: 0, accepted: 0, generatedSec: 0, spend: 0 }) };
  }

  /** Smoothed acceptance rate, never 0 so effective cost stays finite. */
  acceptanceRate(modelKey: string, tier: ModelTier): number {
    const s = this.get(modelKey);
    const rate = (s.accepted + ACCEPTANCE_PRIOR[tier] * PRIOR_WEIGHT) / (s.calls + PRIOR_WEIGHT);
    return Math.max(rate, 0.05);
  }

  all(): Array<[string, ModelStats]> {
    return [...this.stats.entries()].map(([k, v]) => [k, { ...v }]);
  }
}
