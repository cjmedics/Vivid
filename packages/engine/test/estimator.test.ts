import { describe, expect, it } from "vitest";
import { PLANS, PlanPolicyError } from "@vivid/core";
import { buildFeatureReveal, estimateProduction, intensityMultiplier, quoteRefinement, roundUpTenth } from "../src/index.js";
import { genShot, loadFixtureIR, routeDeps } from "./helpers.js";

const ir = loadFixtureIR();

describe("estimateProduction", () => {
  it("matches the doc's Build Minute formula (§7)", () => {
    // 60s × 1.25 (1080p) × 1.5 (cinematic intensity) × 1.0 = 1.875 → 1.9
    expect(roundUpTenth((60 / 60) * 1.25 * intensityMultiplier(0.6) * 1.0)).toBe(1.9);
    expect(roundUpTenth(0.8000000001)).toBe(0.8);
  });

  it("charges the formula for a deterministic video", () => {
    const plan = buildFeatureReveal(ir, { styleId: "technical", quality: "production", aspectRatio: "16:9", id: "t" });
    const est = estimateProduction({ plan, account: PLANS.pro, route: routeDeps() });
    expect(est.generativeSec).toBe(0);
    expect(est.internal.generation).toBe(0);
    expect(est.chargeBasis).toBe("formula");
    expect(est.buildMinutes).toBe(roundUpTenth((est.durationSec / 60) * 1.25));
  });

  it("raises Build Minutes when internal cost outruns the formula (margin guard)", () => {
    const plan = buildFeatureReveal(ir, { styleId: "technical", quality: "production", aspectRatio: "16:9", id: "p" });
    const premium = genShot({ durationSec: 8, capabilities: ["motion-transfer"], premiumJustification: "required-capability" }, 8);
    plan.shots = [premium];
    const est = estimateProduction({ plan, account: PLANS.studio, route: routeDeps() });
    expect(est.chargeBasis).toBe("cost-floor");
    expect(est.buildMinutes).toBeGreaterThan(est.formulaBuildMinutes);
    // Internal cost per Build Minute charged never exceeds the target.
    expect(est.internal.total / est.buildMinutes).toBeLessThanOrEqual(1_250_000);
  });

  it("caps Starter output at 720p even in production mode", () => {
    const plan = buildFeatureReveal(ir, { styleId: "minimal", quality: "production", aspectRatio: "16:9", id: "s" });
    expect(estimateProduction({ plan, account: PLANS.starter, route: routeDeps() }).resolution).toBe("720p");
  });

  it("rejects modes the plan doesn't include", () => {
    const plan = buildFeatureReveal(ir, { styleId: "minimal", quality: "master", aspectRatio: "16:9", id: "m" });
    expect(() => estimateProduction({ plan, account: PLANS.pro, route: routeDeps() })).toThrow(PlanPolicyError);
  });
});

describe("quoteRefinement", () => {
  it("uses base units for cheap deterministic edits and raises them for expensive regenerations", () => {
    const plan = buildFeatureReveal(ir, { styleId: "minimal", quality: "production", aspectRatio: "16:9", id: "r" });
    const deterministic = plan.shots.find((s) => s.mode === "deterministic")!;
    const minor = quoteRefinement({ kind: "minor", affectedShots: [deterministic], account: PLANS.pro, quality: "production", route: routeDeps() });
    expect(minor.units).toBe(1);

    const premium = genShot({ durationSec: 8, capabilities: ["motion-transfer"], premiumJustification: "required-capability" }, 8);
    const major = quoteRefinement({ kind: "major", affectedShots: [premium], account: PLANS.studio, quality: "production", route: routeDeps() });
    expect(major.chargeBasis).toBe("cost-floor");
    expect(major.units).toBeGreaterThan(3);
  });
});
