import { describe, expect, it } from "vitest";
import { generativeSeconds, planDurationSec } from "@vivid/core";
import { PresetEvidenceError, STYLES, buildFeatureReveal, type StyleId } from "../src/index.js";
import { loadFixtureIR } from "./helpers.js";

const ir = loadFixtureIR();

describe("buildFeatureReveal", () => {
  it("follows the Feature Reveal grammar", () => {
    const plan = buildFeatureReveal(ir, { styleId: "minimal", quality: "production", aspectRatio: "16:9", id: "x" });
    expect(plan.shots.map((s) => s.beat)).toEqual([
      "establish",
      "establish-screen",
      "focus-metric",
      "trigger-interaction",
      "show-state-change",
      "highlight-result",
      "cta",
    ]);
    const focus = plan.shots.find((s) => s.beat === "focus-metric")!;
    expect(focus.primitives.some((p) => p.targetRegionId === "mrr")).toBe(true);
  });

  it.each(Object.keys(STYLES) as StyleId[])("keeps %s within its generative budget", (styleId) => {
    const plan = buildFeatureReveal(ir, { styleId, quality: "production", aspectRatio: "16:9", id: styleId });
    expect(generativeSeconds(plan)).toBeLessThanOrEqual(planDurationSec(plan) * STYLES[styleId].generativeBudget + 1e-9);
  });

  it("keeps every primitive inside its shot", () => {
    const plan = buildFeatureReveal(ir, { styleId: "cinematic", quality: "production", aspectRatio: "16:9", targetDurationSec: 25, id: "c" });
    for (const shot of plan.shots) {
      for (const p of shot.primitives) expect(p.startSec + p.durationSec).toBeLessThanOrEqual(shot.durationSec + 1e-9);
    }
  });

  it("refuses to build without its evidence requirement", () => {
    const noMetric = { ...ir, screens: [{ ...ir.screens[0]!, regions: ir.screens[0]!.regions.filter((r) => r.kind !== "metric") }] };
    expect(() => buildFeatureReveal(noMetric, { styleId: "minimal", quality: "draft", aspectRatio: "16:9" })).toThrow(PresetEvidenceError);
  });
});
