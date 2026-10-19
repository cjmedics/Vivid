import { z } from "zod";

/** Motion library metadata (cost doc §12). Searchable by the planner instead of loading the whole library. */
export const MotionCategory = z.enum([
  "navigation",
  "interaction",
  "data",
  "camera",
  "typography",
  "transitions",
  "presentation",
]);
export type MotionCategory = z.infer<typeof MotionCategory>;

export const MotionPrimitive = z.object({
  id: z.string(),
  category: MotionCategory,
  compatibleWith: z.array(z.string()),
  duration: z.object({ min: z.number().positive(), max: z.number().positive() }),
  energy: z.enum(["low", "medium", "high"]),
  brandSafety: z.enum(["low", "medium", "high"]),
  renderer: z.enum(["deterministic", "hybrid", "generative"]),
});
export type MotionPrimitive = z.infer<typeof MotionPrimitive>;

export const MOTION_LIBRARY: MotionPrimitive[] = [
  { id: "typography/line-reveal", category: "typography", compatibleWith: ["headline", "text"], duration: { min: 0.8, max: 3 }, energy: "low", brandSafety: "high", renderer: "deterministic" },
  { id: "typography/word-reveal", category: "typography", compatibleWith: ["headline", "subtext"], duration: { min: 1, max: 4 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "camera/push-in", category: "camera", compatibleWith: ["screen", "metric", "chart", "card"], duration: { min: 1, max: 4 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "camera/pull-out", category: "camera", compatibleWith: ["screen"], duration: { min: 1, max: 4 }, energy: "low", brandSafety: "high", renderer: "deterministic" },
  { id: "interaction/cursor-click", category: "interaction", compatibleWith: ["button", "input", "card"], duration: { min: 0.8, max: 2.5 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "interaction/hover-focus", category: "interaction", compatibleWith: ["button", "card", "metric"], duration: { min: 0.5, max: 2 }, energy: "low", brandSafety: "high", renderer: "deterministic" },
  { id: "data/counter-tick", category: "data", compatibleWith: ["metric", "number", "stat"], duration: { min: 0.5, max: 2 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "data/metric-emphasis", category: "data", compatibleWith: ["metric", "stat"], duration: { min: 0.8, max: 2.5 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "data/chart-grow", category: "data", compatibleWith: ["chart"], duration: { min: 1, max: 3 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "transitions/dissolve", category: "transitions", compatibleWith: ["any"], duration: { min: 0.3, max: 1 }, energy: "low", brandSafety: "high", renderer: "deterministic" },
  { id: "transitions/slide", category: "transitions", compatibleWith: ["any"], duration: { min: 0.3, max: 1 }, energy: "medium", brandSafety: "high", renderer: "deterministic" },
  { id: "presentation/cta-card", category: "presentation", compatibleWith: ["cta"], duration: { min: 2, max: 5 }, energy: "low", brandSafety: "high", renderer: "deterministic" },
  { id: "presentation/ambient-backdrop", category: "presentation", compatibleWith: ["establish", "intro"], duration: { min: 2, max: 8 }, energy: "medium", brandSafety: "medium", renderer: "hybrid" },
  { id: "presentation/cinematic-plate", category: "presentation", compatibleWith: ["establish", "intro", "outro"], duration: { min: 2, max: 8 }, energy: "high", brandSafety: "low", renderer: "generative" },
];

export function findPrimitive(id: string): MotionPrimitive {
  const found = MOTION_LIBRARY.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown motion primitive: ${id}`);
  return found;
}

export function searchPrimitives(query: { compatibleWith?: string; category?: MotionCategory; renderer?: MotionPrimitive["renderer"] }): MotionPrimitive[] {
  return MOTION_LIBRARY.filter(
    (p) =>
      (!query.compatibleWith || p.compatibleWith.includes(query.compatibleWith) || p.compatibleWith.includes("any")) &&
      (!query.category || p.category === query.category) &&
      (!query.renderer || p.renderer === query.renderer),
  );
}
