import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLANS, ProductIR, type PlanId, type Shot } from "@vivid/core";
import { DEFAULT_CATALOG, ModelTelemetry, type ProviderId } from "../src/index.js";

export function loadFixtureIR(): ProductIR {
  const path = fileURLToPath(new URL("../../../fixtures/ledgerly.ir.json", import.meta.url));
  return ProductIR.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function routeDeps(providers: ProviderId[] = ["openrouter", "higgsfield", "google"], telemetry = new ModelTelemetry()) {
  return { catalog: DEFAULT_CATALOG, telemetry, availableProviders: new Set<ProviderId>(providers) };
}

export function ctx(planId: PlanId = "pro", resolution: "720p" | "1080p" | "4k" = "1080p", providers?: ProviderId[], telemetry?: ModelTelemetry) {
  return { ...routeDeps(providers, telemetry), plan: PLANS[planId], resolution };
}

export function genShot(overrides: Partial<NonNullable<Shot["generation"]>> = {}, durationSec = 5): Shot {
  return {
    id: "g1",
    sceneId: "intro",
    beat: "establish",
    durationSec,
    mode: "hybrid",
    primitives: [],
    generation: {
      prompt: "abstract backdrop",
      durationSec,
      capabilities: ["text-to-video"],
      referenceImageUrls: [],
      audio: false,
      minTier: "efficient",
      ...overrides,
    },
  };
}
