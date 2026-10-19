import { PacingProfile, ProductIR, validateShotPlan, type Shot, type ShotPlan } from "@vivid/core";

/** A static-design reveal. It never invents clicks, numeric changes, or working product behavior. */
export function buildDesignReveal(input: ProductIR, options: { pacing?: unknown; id?: string } = {}): ShotPlan {
  const ir = ProductIR.parse(input);
  const pacing = PacingProfile.parse(options.pacing ?? {});
  const screen = ir.screens[0]!;
  if (!screen.captureUrl) throw new Error("Design Reveal needs an exported frame capture");
  const ranked = [...screen.regions].filter((r) => r.kind !== "nav" && r.kind !== "sidebar")
    .sort((a, b) => b.focalScore - a.focalScore || a.id.localeCompare(b.id));
  // Prefer distinct areas; a parent and its child should not occupy consecutive focus shots.
  const selected = ranked.filter((r, i) => !ranked.slice(0, i).some((other) => {
    const a = r.bbox; const b = other.bbox;
    const intersection = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return intersection / Math.min(a.w * a.h, b.w * b.h) > 0.7;
  })).slice(0, 3);
  const shots: Shot[] = [];
  const add = (beat: string, durationSec: number, primitives: Shot["primitives"]) => {
    const id = `design-${shots.length + 1}`;
    shots.push({ id, sceneId: beat, beat, durationSec, mode: "deterministic", primitives: [
      ...(shots.length ? [{ primitiveId: "transitions/dissolve", startSec: 0, durationSec: pacing.transitionSec, params: {} }] : []),
      ...primitives,
    ] });
  };
  add("establish", pacing.introSec, [{ primitiveId: "typography/word-reveal", startSec: 0.2, durationSec: pacing.introSec - 0.4, params: { slot: "headline" } }]);
  add("establish-screen", pacing.overviewSec, [
    { primitiveId: "camera/pull-out", startSec: 0, durationSec: pacing.overviewSec, screenId: screen.id, params: {} },
    { primitiveId: "typography/line-reveal", startSec: 0.5, durationSec: 1.5, params: { slot: "subtext" } },
  ]);
  for (const region of selected) {
    add("focus-design", pacing.focusSec, [
      { primitiveId: "camera/push-in", startSec: 0, durationSec: pacing.focusSec * 0.7, screenId: screen.id, targetRegionId: region.id, params: {} },
      { primitiveId: "presentation/region-highlight", startSec: 0.5, durationSec: pacing.focusSec - 0.5, screenId: screen.id, targetRegionId: region.id, params: {} },
    ]);
  }
  add("cta", pacing.outroSec, [{ primitiveId: "presentation/cta-card", startSec: 0, durationSec: pacing.outroSec, params: {} }]);
  return validateShotPlan({
    id: options.id ?? `prod-${crypto.randomUUID()}`, presetId: "design-reveal", styleId: "technical",
    productName: ir.product.name, aspectRatio: "16:9", quality: "production", fps: 30,
    brand: ir.brand, copy: ir.copy, screens: [screen], source: ir.source, pacing, shots,
  });
}
