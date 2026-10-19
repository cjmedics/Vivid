import type { PrimitiveUse, Region, Screen, Shot, ShotPlan } from "@vivid/core";

export type { PrimitiveUse, Region, Screen, Shot, ShotPlan };

export type ShotAsset =
  | { kind: "deterministic" }
  | { kind: "generated"; url: string; modelKey: string; generatedSec: number; attempts: number };

/** Props for the `Vivid` composition — written by the engine (see apps/demo --write-plan). */
export type VividProps = {
  plan: ShotPlan;
  width: number;
  height: number;
  assets: Record<string, ShotAsset>;
};
