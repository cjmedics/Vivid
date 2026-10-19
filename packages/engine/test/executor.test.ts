import { describe, expect, it } from "vitest";
import { PLANS, type Shot } from "@vivid/core";
import {
  DurationValidator,
  InMemoryLedger,
  InsufficientBalanceError,
  MockProvider,
  ModelTelemetry,
  buildFeatureReveal,
  estimateProduction,
  executeProduction,
  type ProviderId,
  type ProviderRegistry,
  type ShotValidator,
} from "../src/index.js";
import { loadFixtureIR, routeDeps } from "./helpers.js";

const ir = loadFixtureIR();

function setup(opts: { providers?: ProviderRegistry; validator?: ShotValidator; planId?: "starter" | "pro" | "studio" } = {}) {
  const telemetry = new ModelTelemetry();
  const providers: ProviderRegistry =
    opts.providers ?? new Map<ProviderId, MockProvider>([["openrouter", new MockProvider("openrouter")], ["higgsfield", new MockProvider("higgsfield")]]);
  const account = PLANS[opts.planId ?? "studio"];
  const plan = buildFeatureReveal(ir, { styleId: "cinematic", quality: "production", aspectRatio: "16:9", id: "prod-1" });
  const estimate = estimateProduction({ plan, account, route: { ...routeDeps([...providers.keys()], telemetry) } });
  const ledger = new InMemoryLedger();
  ledger.openAccount("acct", account.id);
  return { telemetry, providers, plan, estimate, ledger, validator: opts.validator ?? new DurationValidator() };
}

describe("executeProduction", () => {
  it("charges the approved estimate and records every attempt", async () => {
    const s = setup();
    const result = await executeProduction({ accountId: "acct", ...s, pollIntervalMs: 0 });
    expect(result.status).toBe("completed");
    expect(s.ledger.usage("acct").buildMinutes.used).toBe(s.estimate.buildMinutes);
    const report = s.ledger.costReport("prod-1");
    expect(report.byModel.reduce((n, m) => n + m.accepted, 0)).toBe(s.plan.shots.filter((x) => x.generation).length);
    expect(report.retries).toBe(0);
  });

  it("retries only the failed shot (rule 3)", async () => {
    const rejectedOnce = new Set<string>();
    const validator: ShotValidator = {
      async validate(shot: Shot) {
        if (shot.beat === "cta" && !rejectedOnce.has(shot.id)) {
          rejectedOnce.add(shot.id);
          return { pass: false, reason: "test rejection" };
        }
        return { pass: true };
      },
    };
    const s = setup({ validator });
    const result = await executeProduction({ accountId: "acct", ...s, pollIntervalMs: 0 });
    expect(result.status).toBe("completed");
    const cta = s.plan.shots.find((x) => x.beat === "cta")!;
    const intro = s.plan.shots.find((x) => x.beat === "establish")!;
    expect(result.assets[cta.id]).toMatchObject({ kind: "generated", attempts: 2 });
    expect(result.assets[intro.id]).toMatchObject({ kind: "generated", attempts: 1 });
    expect(s.ledger.costReport("prod-1").retries).toBeGreaterThan(0);
  });

  it("falls back to another provider during an outage", async () => {
    const providers: ProviderRegistry = new Map<ProviderId, MockProvider>([
      ["openrouter", new MockProvider("openrouter", { unavailable: true })],
      ["higgsfield", new MockProvider("higgsfield")],
    ]);
    const s = setup({ providers });
    const result = await executeProduction({ accountId: "acct", ...s, pollIntervalMs: 0 });
    expect(result.status).toBe("completed");
    for (const asset of Object.values(result.assets)) {
      if (asset.kind === "generated") expect(asset.modelKey.startsWith("higgsfield:")).toBe(true);
    }
  });

  it("charges nothing when a shot can't be produced", async () => {
    const s = setup({ validator: { validate: async () => ({ pass: false, reason: "always bad" }) } });
    const result = await executeProduction({ accountId: "acct", ...s, pollIntervalMs: 0 });
    expect(result.status).toBe("failed");
    expect(s.ledger.usage("acct").buildMinutes.used).toBe(0);
    expect(s.ledger.usage("acct").buildMinutes.reserved).toBe(0);
    expect(s.ledger.costReport("prod-1").total).toBeGreaterThan(0); // we still paid providers
  });
});

describe("InMemoryLedger", () => {
  it("blocks reservations beyond the plan allowance", () => {
    const ledger = new InMemoryLedger();
    ledger.openAccount("a", "starter");
    ledger.reserve("a", { productionId: "p1", buildMinutes: 9.7, refinementUnits: 0 });
    expect(() => ledger.reserve("a", { productionId: "p2", buildMinutes: 0.4, refinementUnits: 0 })).toThrow(InsufficientBalanceError);
    ledger.reserve("a", { productionId: "p3", buildMinutes: 0.3, refinementUnits: 0 });
    expect(ledger.usage("a").buildMinutes.available).toBe(0);
  });

  it("consumes refinement units on charge and frees them on release", () => {
    const ledger = new InMemoryLedger();
    ledger.openAccount("a", "pro");
    const r1 = ledger.reserve("a", { productionId: "p", buildMinutes: 0, refinementUnits: 5 });
    const r2 = ledger.reserve("a", { productionId: "p", buildMinutes: 0, refinementUnits: 7 });
    ledger.charge(r1.id);
    ledger.release(r2.id);
    expect(ledger.usage("a").refinementUnits).toMatchObject({ used: 5, reserved: 0, available: 55 });
    expect(() => ledger.charge(r1.id)).toThrow();
  });
});
