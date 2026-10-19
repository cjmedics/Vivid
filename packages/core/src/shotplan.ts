import { z } from "zod";
import { AspectRatio, QualityMode } from "./media.js";
import { Brand } from "./ir.js";

/**
 * ShotPlan — the single production spec. The renderer, router, estimator and ledger
 * all consume this same object (cost doc §25: pricing is an output of the engine).
 */

export const ExecutionMode = z.enum(["deterministic", "hybrid", "generative"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const Capability = z.enum([
  "text-to-video",
  "image-to-video",
  "reference-to-video",
  "video-input",
  "audio",
  "multi-shot",
  "motion-transfer",
]);
export type Capability = z.infer<typeof Capability>;

export const ModelTier = z.enum(["efficient", "balanced", "premium"]);
export type ModelTier = z.infer<typeof ModelTier>;

export const PrimitiveUse = z.object({
  primitiveId: z.string(),
  /** Seconds from shot start. */
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  screenId: z.string().optional(),
  targetRegionId: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type PrimitiveUse = z.infer<typeof PrimitiveUse>;

export const GenerationRequest = z.object({
  prompt: z.string(),
  /** Seconds of generated footage needed. For hybrid shots this can be less than the shot. */
  durationSec: z.number().positive(),
  capabilities: z.array(Capability).min(1),
  referenceImageUrls: z.array(z.string()).default([]),
  audio: z.boolean().default(false),
  /** Lowest tier allowed to attempt this shot. Defaults to efficient. */
  minTier: ModelTier.default("efficient"),
  /** Required before the router may pick a premium model (cost doc §15 rule 5). */
  premiumJustification: z
    .enum(["required-capability", "reference-fidelity", "quality-target"])
    .optional(),
});
export type GenerationRequest = z.infer<typeof GenerationRequest>;

export const Shot = z
  .object({
    id: z.string(),
    sceneId: z.string(),
    /** Grammar step this shot implements, e.g. "establish", "focus-metric". */
    beat: z.string(),
    durationSec: z.number().positive(),
    mode: ExecutionMode,
    primitives: z.array(PrimitiveUse),
    generation: GenerationRequest.optional(),
  })
  .refine((s) => s.mode === "deterministic" || s.generation !== undefined, {
    message: "hybrid/generative shots need a generation request",
  })
  .refine((s) => !s.generation || s.generation.durationSec <= s.durationSec + 1e-9, {
    message: "generated footage cannot exceed shot duration",
  });
export type Shot = z.infer<typeof Shot>;

export const ShotPlan = z.object({
  id: z.string(),
  presetId: z.string(),
  styleId: z.string(),
  productName: z.string(),
  aspectRatio: AspectRatio,
  quality: QualityMode,
  fps: z.number().int().positive(),
  brand: Brand,
  copy: z.object({ headline: z.string(), subtext: z.string(), cta: z.string() }),
  /** Screens referenced by primitives, carried so the renderer is self-contained. */
  screens: z.array(z.any()),
  shots: z.array(Shot).min(1),
});
export type ShotPlan = z.infer<typeof ShotPlan>;

export function planDurationSec(plan: Pick<ShotPlan, "shots">): number {
  return plan.shots.reduce((sum, s) => sum + s.durationSec, 0);
}

/** Seconds that must come from a video model. */
export function generativeSeconds(plan: Pick<ShotPlan, "shots">): number {
  return plan.shots.reduce((sum, s) => sum + (s.mode === "deterministic" ? 0 : (s.generation?.durationSec ?? 0)), 0);
}
