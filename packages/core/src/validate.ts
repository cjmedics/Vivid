import { ShotPlan } from "./shotplan.js";
import { Screen } from "./ir.js";
import { findPrimitive } from "./motion.js";

/** Semantic validation beyond Zod's structural shape. Run before estimates and renders. */
export function validateShotPlan(input: unknown): ShotPlan {
  const plan = ShotPlan.parse(input);
  const screens = plan.screens.map((s) => Screen.parse(s));
  unique(screens.map((s) => s.id), "screen");
  unique(plan.shots.map((s) => s.id), "shot");
  for (const s of screens) {
    unique(s.regions.map((r) => r.id), `region in ${s.id}`);
    if (s.captureUrl && (!s.width || !s.height)) throw new Error(`${s.id}: captured screens need original dimensions`);
  }
  for (const shot of plan.shots) {
    if (Math.round(shot.durationSec * plan.fps) < 1) throw new Error(`${shot.id}: shot must occupy a frame`);
    if (shot.mode === "deterministic" && shot.generation) throw new Error(`${shot.id}: deterministic shot cannot request generation`);
    for (const p of shot.primitives) {
      const primitive = findPrimitive(p.primitiveId);
      const spatial = /^(camera|data|interaction)\//.test(p.primitiveId) || p.primitiveId === "presentation/region-highlight";
      if (spatial && !p.screenId) throw new Error(`${shot.id}: ${p.primitiveId} needs a screen`);
      if (spatial && p.primitiveId !== "camera/pull-out" && !p.targetRegionId) throw new Error(`${shot.id}: ${p.primitiveId} needs a target region`);
      if (p.startSec + p.durationSec > shot.durationSec + 1e-6) throw new Error(`${shot.id}: primitive extends beyond shot`);
      const screen = screens.find((s) => s.id === p.screenId);
      if (p.screenId && !screen) throw new Error(`${shot.id}: unknown screen ${p.screenId}`);
      const region = screen?.regions.find((r) => r.id === p.targetRegionId);
      if (p.targetRegionId && !region) throw new Error(`${shot.id}: unknown target ${p.targetRegionId}`);
      if (region && !primitive.compatibleWith.includes("any") && !primitive.compatibleWith.includes(region.kind)) {
        throw new Error(`${shot.id}: ${p.primitiveId} is incompatible with ${region.kind}`);
      }
      if (screen?.captureUrl && ["data/counter-tick", "data/chart-grow"].includes(p.primitiveId)) {
        throw new Error(`${shot.id}: static capture cannot animate product data`);
      }
    }
  }
  return plan;
}

function unique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} IDs`);
}
