import {
  ShotPlan,
  findPrimitive,
  generativeSeconds,
  planDurationSec,
  type AspectRatio,
  type GenerationRequest,
  type PrimitiveUse,
  type ProductIR,
  type QualityMode,
  type Region,
  type RegionKind,
  type Shot,
} from "@vivid/core";
import { STYLES, type StyleId, type StyleProfile } from "./styles.js";

/**
 * FEATURE_REVEAL grammar (cost doc §11):
 *   establish → establish screen → focus metric → trigger interaction
 *   → show state change → highlight result → CTA
 */

export const FEATURE_REVEAL_ID = "feature-reveal";

type Beat = "establish" | "establish-screen" | "focus-metric" | "trigger-interaction" | "show-state-change" | "highlight-result" | "cta";

const GRAMMAR: Array<{ beat: Beat; scene: string; baseSec: number }> = [
  { beat: "establish", scene: "intro", baseSec: 5 },
  { beat: "establish-screen", scene: "intro", baseSec: 5 },
  { beat: "focus-metric", scene: "feature", baseSec: 5 },
  { beat: "trigger-interaction", scene: "feature", baseSec: 5 },
  { beat: "show-state-change", scene: "feature", baseSec: 5 },
  { beat: "highlight-result", scene: "feature", baseSec: 5 },
  { beat: "cta", scene: "outro", baseSec: 4 },
];

const TRANSITION_SEC = 0.5;
const MIN_GENERATED_SEC = 2;

export class PresetEvidenceError extends Error {}

export interface FeatureRevealOptions {
  styleId: StyleId;
  quality: QualityMode;
  aspectRatio: AspectRatio;
  targetDurationSec?: number;
  fps?: number;
  id?: string;
  /** Which screen holds the feature; defaults to the first. */
  screenId?: string;
}

export function buildFeatureReveal(ir: ProductIR, opts: FeatureRevealOptions): ShotPlan {
  const style = STYLES[opts.styleId];
  const screen = opts.screenId ? ir.screens.find((s) => s.id === opts.screenId) : ir.screens[0];
  if (!screen) throw new PresetEvidenceError(`Screen ${opts.screenId} not found`);

  // Evidence requirements: the feature must have a metric to reveal.
  const metric = top(screen.regions, ["metric"]);
  if (!metric) throw new PresetEvidenceError("Feature Reveal needs at least one metric region on the screen");
  const trigger = top(screen.regions, ["button", "input", "card"]);
  const result = top(screen.regions, ["chart"]) ?? metric;

  const baseTotal = GRAMMAR.filter((g) => g.beat !== "trigger-interaction" || trigger).reduce((s, g) => s + g.baseSec, 0);
  const scale = opts.targetDurationSec ? clamp(opts.targetDurationSec / baseTotal, 0.6, 1.6) : style.pacing;

  const shots: Shot[] = [];
  for (const g of GRAMMAR) {
    if (g.beat === "trigger-interaction" && !trigger) continue;
    const durationSec = round1(g.baseSec * scale);
    const index = shots.length;
    const primitives: PrimitiveUse[] = [];
    if (index > 0) primitives.push(use(style.transition, 0, TRANSITION_SEC));

    let mode: Shot["mode"] = "deterministic";
    let generation: GenerationRequest | undefined;

    switch (g.beat) {
      case "establish": {
        primitives.push(use(style.typography, 0.4, durationSec - 0.8, { params: { slot: "headline" } }));
        if (style.backdrop === "ambient") {
          mode = "hybrid";
          primitives.unshift(use("presentation/ambient-backdrop", 0, durationSec));
          generation = backdropRequest(ir, durationSec, "ambient");
        } else if (style.backdrop === "cinematic") {
          mode = "hybrid";
          primitives.unshift(use("presentation/cinematic-plate", 0, durationSec));
          generation = backdropRequest(ir, durationSec, "cinematic");
        }
        break;
      }
      case "establish-screen":
        primitives.push(use("camera/pull-out", 0, durationSec, { screenId: screen.id }));
        primitives.push(use(style.typography, 0.6, Math.min(2.5, durationSec - 0.6), { params: { slot: "subtext" } }));
        break;
      case "focus-metric":
        primitives.push(use("camera/push-in", 0, durationSec * 0.6, { screenId: screen.id, targetRegionId: metric.id }));
        primitives.push(use("data/metric-emphasis", durationSec * 0.5, durationSec * 0.45, { screenId: screen.id, targetRegionId: metric.id }));
        break;
      case "trigger-interaction":
        primitives.push(use("interaction/cursor-click", 0.3, Math.min(2.5, durationSec - 0.3), { screenId: screen.id, targetRegionId: trigger!.id }));
        break;
      case "show-state-change":
        primitives.push(use("data/counter-tick", 0.2, Math.min(2, durationSec - 0.2), {
          screenId: screen.id,
          targetRegionId: metric.id,
          params: { from: metric.value ?? "", to: metric.valueAfter ?? metric.value ?? "" },
        }));
        break;
      case "highlight-result":
        primitives.push(
          result.kind === "chart"
            ? use("data/chart-grow", 0.2, Math.min(3, durationSec - 0.2), { screenId: screen.id, targetRegionId: result.id })
            : use("data/metric-emphasis", 0.2, Math.min(2.5, durationSec - 0.2), { screenId: screen.id, targetRegionId: result.id }),
        );
        break;
      case "cta":
        primitives.push(use("presentation/cta-card", 0, durationSec));
        if (style.backdrop === "cinematic") {
          mode = "hybrid";
          primitives.unshift(use("presentation/cinematic-plate", 0, durationSec));
          generation = backdropRequest(ir, durationSec, "cinematic");
        }
        break;
    }

    shots.push({
      id: `s${String(index + 1).padStart(2, "0")}`,
      sceneId: g.scene,
      beat: g.beat,
      durationSec,
      mode,
      primitives: primitives.map(clampToShot(durationSec)),
      ...(generation ? { generation } : {}),
    });
  }

  enforceGenerativeBudget(shots, style);

  return ShotPlan.parse({
    id: opts.id ?? `prod-${crypto.randomUUID()}`,
    presetId: FEATURE_REVEAL_ID,
    styleId: style.id,
    productName: ir.product.name,
    aspectRatio: opts.aspectRatio,
    quality: opts.quality,
    fps: opts.fps ?? 30,
    brand: ir.brand,
    copy: ir.copy,
    screens: [screen],
    shots,
  });
}

/** Generative footage never depicts UI, text or logos — those stay deterministic and brand-exact. */
function backdropRequest(ir: ProductIR, durationSec: number, kind: "ambient" | "cinematic"): GenerationRequest {
  const { primary, accent, background } = ir.brand;
  const prompt =
    kind === "ambient"
      ? `Slow abstract ambient motion background. Soft gradients blending ${primary} and ${accent} over ${background}. Subtle parallax drift, calm and premium, suited to a ${ir.product.category} product. No text, no logos, no user interface, no people.`
      : `Cinematic abstract light sculpture, volumetric light sweeping across glossy geometric forms in ${primary} and ${accent} on ${background}. Slow dolly-in, shallow depth of field, high-end product launch mood. No text, no logos, no user interface, no people.`;
  return {
    prompt,
    durationSec,
    capabilities: ["text-to-video"],
    referenceImageUrls: [],
    audio: false,
    minTier: kind === "cinematic" ? "balanced" : "efficient",
  };
}

/** Trim generated footage (longest first) until the style's budget holds; drop generation below 2s. */
function enforceGenerativeBudget(shots: Shot[], style: StyleProfile): void {
  const budget = planDurationSec({ shots }) * style.generativeBudget;
  let over = generativeSeconds({ shots }) - budget;
  const generative = shots.filter((s) => s.generation).sort((a, b) => b.generation!.durationSec - a.generation!.durationSec);
  for (const shot of generative) {
    if (over <= 1e-9) break;
    const gen = shot.generation!;
    const trimmed = round1(Math.max(gen.durationSec - over, 0));
    if (trimmed >= MIN_GENERATED_SEC) {
      over -= gen.durationSec - trimmed;
      gen.durationSec = trimmed;
    } else {
      over -= gen.durationSec;
      shot.mode = "deterministic";
      delete shot.generation;
      shot.primitives = shot.primitives.filter((p) => findPrimitive(p.primitiveId).renderer === "deterministic");
    }
  }
}

function top(regions: Region[], kinds: RegionKind[]): Region | undefined {
  return regions.filter((r) => kinds.includes(r.kind)).sort((a, b) => b.focalScore - a.focalScore)[0];
}

function use(
  primitiveId: string,
  startSec: number,
  durationSec: number,
  extra: { screenId?: string; targetRegionId?: string; params?: PrimitiveUse["params"] } = {},
): PrimitiveUse {
  findPrimitive(primitiveId); // fail fast on typos
  return { primitiveId, startSec: round1(startSec), durationSec: round1(durationSec), params: extra.params ?? {}, ...stripUndefined(extra) };
}

function clampToShot(shotSec: number) {
  return (p: PrimitiveUse): PrimitiveUse => ({ ...p, durationSec: round1(Math.max(0.1, Math.min(p.durationSec, shotSec - p.startSec))) });
}

function stripUndefined(o: { screenId?: string; targetRegionId?: string }) {
  return {
    ...(o.screenId ? { screenId: o.screenId } : {}),
    ...(o.targetRegionId ? { targetRegionId: o.targetRegionId } : {}),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
