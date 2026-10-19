import { QUALITY_RESOLUTION, type AspectRatio, type QualityMode, type Resolution } from "./media.js";

export type PlanId = "starter" | "pro" | "studio" | "business";

export interface PlanDefinition {
  id: PlanId;
  displayName: string;
  /** Monthly price in USD cents. Business is negotiated, so null. */
  priceUsdCents: number | null;
  buildMinutes: number;
  refinementUnits: number;
  /** Routing policies the plan may use. */
  qualityModes: QualityMode[];
  /** Output resolution cap, independent of quality mode (Starter routes Production but outputs 720p). */
  maxResolution: Resolution;
  aspectRatios: AspectRatio[];
  /** Premium/specialist generation routes (cost doc §15 rule 5 still applies on top). */
  premiumRouting: boolean;
  maxConcurrentGenerations: number;
}

/** Cost doc §13–14, USD pricing (decided 2026-10-16). */
export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    displayName: "Starter",
    priceUsdCents: 3900,
    buildMinutes: 10,
    refinementUnits: 20,
    qualityModes: ["draft", "production"],
    maxResolution: "720p",
    aspectRatios: ["16:9"],
    premiumRouting: false,
    maxConcurrentGenerations: 1,
  },
  pro: {
    id: "pro",
    displayName: "Pro",
    priceUsdCents: 11900,
    buildMinutes: 35,
    refinementUnits: 60,
    qualityModes: ["draft", "production"],
    maxResolution: "1080p",
    aspectRatios: ["16:9", "9:16"],
    premiumRouting: false,
    maxConcurrentGenerations: 2,
  },
  studio: {
    id: "studio",
    displayName: "Studio",
    priceUsdCents: 29900,
    buildMinutes: 100,
    refinementUnits: 200,
    qualityModes: ["draft", "production", "master"],
    maxResolution: "4k",
    aspectRatios: ["16:9", "9:16", "1:1"],
    premiumRouting: true,
    maxConcurrentGenerations: 4,
  },
  business: {
    id: "business",
    displayName: "Business",
    priceUsdCents: null,
    buildMinutes: 250,
    refinementUnits: 600,
    qualityModes: ["draft", "production", "master"],
    maxResolution: "4k",
    aspectRatios: ["16:9", "9:16", "1:1"],
    premiumRouting: true,
    maxConcurrentGenerations: 8,
  },
};

const RES_ORDER: Resolution[] = ["480p", "720p", "1080p", "4k"];

/** Resolution actually produced: the quality mode's target, capped by the plan. */
export function outputResolution(plan: PlanDefinition, quality: QualityMode): Resolution {
  const wanted = QUALITY_RESOLUTION[quality];
  return RES_ORDER.indexOf(wanted) <= RES_ORDER.indexOf(plan.maxResolution) ? wanted : plan.maxResolution;
}

export class PlanPolicyError extends Error {}

export function assertPlanAllows(plan: PlanDefinition, quality: QualityMode, aspect: AspectRatio): void {
  if (!plan.qualityModes.includes(quality)) {
    throw new PlanPolicyError(`${plan.displayName} does not include ${quality} mode`);
  }
  if (!plan.aspectRatios.includes(aspect)) {
    throw new PlanPolicyError(`${plan.displayName} does not include ${aspect} output`);
  }
}
