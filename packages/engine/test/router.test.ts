import { describe, expect, it } from "vitest";
import { ModelTelemetry, NoRouteError, attemptCost, routeShot, DEFAULT_CATALOG } from "../src/index.js";
import { usd } from "@vivid/core";
import { ctx, genShot } from "./helpers.js";

describe("routeShot", () => {
  it("never sends deterministic shots to a model (rule 1)", () => {
    const shot = { ...genShot(), mode: "deterministic" as const, generation: undefined };
    expect(routeShot(shot, ctx()).kind).toBe("deterministic");
  });

  it("picks the cheapest qualifying efficient model by cost per accepted second (rule 2)", () => {
    const route = routeShot(genShot(), ctx("pro", "720p"));
    if (route.kind !== "generate") throw new Error("expected generate");
    expect(route.tier).toBe("efficient");
    const sameTier = [route.primary, ...route.chain].filter((c) => c.model.tier === "efficient");
    for (const c of sameTier) expect(route.primary.effectivePerAcceptedSec).toBeLessThanOrEqual(c.effectivePerAcceptedSec);
    // Chain escalates: all efficient candidates come before any balanced one.
    const tiers = [route.primary, ...route.chain].map((c) => c.model.tier);
    expect(tiers.lastIndexOf("efficient")).toBeLessThan(tiers.indexOf("balanced"));
  });

  it("uses acceptance telemetry, not raw price (cost doc §5)", () => {
    const telemetry = new ModelTelemetry();
    const first = routeShot(genShot(), ctx("pro", "720p", undefined, telemetry));
    if (first.kind !== "generate") throw new Error();
    for (let i = 0; i < 40; i++) telemetry.record(first.primary.model.key, { accepted: i % 4 === 0, generatedSec: 5, spend: 0 });
    const second = routeShot(genShot(), ctx("pro", "720p", undefined, telemetry));
    if (second.kind !== "generate") throw new Error();
    expect(second.primary.model.key).not.toBe(first.primary.model.key);
  });

  it("requires plan + justification for premium (rule 5)", () => {
    const motion = genShot({ capabilities: ["motion-transfer"] });
    expect(() => routeShot(motion, ctx("studio"))).toThrow(NoRouteError);
    expect(() => routeShot({ ...motion, generation: { ...motion.generation!, premiumJustification: "required-capability" } }, ctx("pro"))).toThrow(NoRouteError);
    const route = routeShot({ ...motion, generation: { ...motion.generation!, premiumJustification: "required-capability" } }, ctx("studio"));
    if (route.kind !== "generate") throw new Error();
    expect(route.primary.model.modelId).toBe("genjutsu");
  });

  it("skips providers that are not configured", () => {
    const route = routeShot(genShot(), ctx("pro", "1080p", ["higgsfield"]));
    if (route.kind !== "generate") throw new Error();
    expect([route.primary, ...route.chain].every((c) => c.model.providerId === "higgsfield")).toBe(true);
  });
});

describe("pricing", () => {
  it("scales pixel-billed models and uses published per-resolution prices", () => {
    const seedanceFast = DEFAULT_CATALOG.find((m) => m.key === "openrouter:bytedance/seedance-2.0-fast")!;
    // 480p base → 720p is 2.25× the pixels.
    expect(attemptCost(seedanceFast, "720p", 4, false)).toBe(Math.round(usd(0.04035) * 2.25) * 4);
    const veoLite = DEFAULT_CATALOG.find((m) => m.key === "openrouter:google/veo-3.1-lite")!;
    expect(attemptCost(veoLite, "1080p", 3.2, false)).toBe(usd(0.08) * 4);
  });
});
