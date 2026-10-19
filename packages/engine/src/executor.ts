import type { ShotPlan } from "@vivid/core";
import { DEFAULT_COST_MODEL, type CostModel } from "./costs.js";
import type { ProductionEstimate } from "./estimator.js";
import type { UsageLedger } from "./ledger.js";
import { attemptCost } from "./providers/catalog.js";
import { ProviderUnavailableError, type JobStatus, type ProviderRegistry, type VideoProvider } from "./providers/types.js";
import type { RouteCandidate } from "./router.js";
import type { ModelTelemetry } from "./telemetry.js";
import type { ShotValidator } from "./validator.js";

/**
 * Production executor (cost doc §1, §15 rules 3–4).
 * Generative shots run independently; a failed shot is retried alone, first on the same
 * model, then down the router's fallback/escalation chain. Deterministic shots never
 * touch a provider — they go straight to the renderer.
 */

export type ShotAsset =
  | { kind: "deterministic" }
  | { kind: "generated"; url: string; modelKey: string; generatedSec: number; attempts: number };

export interface ProductionResult {
  productionId: string;
  status: "completed" | "failed";
  assets: Record<string, ShotAsset>;
  failedShots: Array<{ shotId: string; reason: string }>;
  chargedBuildMinutes: number;
}

export interface ExecuteInput {
  accountId: string;
  plan: ShotPlan;
  estimate: ProductionEstimate;
  ledger: UsageLedger;
  providers: ProviderRegistry;
  validator: ShotValidator;
  telemetry: ModelTelemetry;
  costModel?: CostModel;
  maxAttemptsPerModel?: number;
  maxAttemptsPerShot?: number;
  concurrency?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  now?: () => Date;
}

export async function executeProduction(input: ExecuteInput): Promise<ProductionResult> {
  const {
    accountId,
    plan,
    estimate,
    ledger,
    costModel = DEFAULT_COST_MODEL,
    concurrency = 1,
  } = input;
  const productionId = plan.id;

  // Rule 6: the estimate the user approved is held before any money is spent.
  const reservation = ledger.reserve(accountId, { productionId, buildMinutes: estimate.buildMinutes, refinementUnits: 0 });

  ledger.recordFixedCost(productionId, "planning", costModel.planningPerProduction);
  ledger.recordFixedCost(productionId, "browser", costModel.browserPerProduction);

  const assets: Record<string, ShotAsset> = {};
  const failedShots: ProductionResult["failedShots"] = [];
  const jobs: Array<() => Promise<void>> = [];

  for (const route of estimate.routes) {
    if (route.kind === "deterministic") {
      assets[route.shotId] = { kind: "deterministic" };
      continue;
    }
    const shot = plan.shots.find((s) => s.id === route.shotId);
    if (!shot) throw new Error(`Estimate references unknown shot ${route.shotId}`);
    jobs.push(async () => {
      const outcome = await produceShot(input, shot, [route.primary, ...route.chain]);
      if (outcome.ok) assets[shot.id] = outcome.asset;
      else failedShots.push({ shotId: shot.id, reason: outcome.reason });
    });
  }

  await runPool(jobs, concurrency);

  if (failedShots.length > 0) {
    // The customer pays for accepted finished video only; a failed production costs them nothing.
    ledger.release(reservation.id);
    return { productionId, status: "failed", assets, failedShots, chargedBuildMinutes: 0 };
  }

  ledger.recordFixedCost(productionId, "rendering", estimate.internal.rendering);
  ledger.recordFixedCost(productionId, "storage", costModel.storagePerProduction);
  ledger.charge(reservation.id);
  return { productionId, status: "completed", assets, failedShots, chargedBuildMinutes: estimate.buildMinutes };
}

type ShotOutcome = { ok: true; asset: ShotAsset } | { ok: false; reason: string };

async function produceShot(input: ExecuteInput, shot: ShotPlan["shots"][number], chain: RouteCandidate[]): Promise<ShotOutcome> {
  const { plan, estimate, ledger, providers, validator, telemetry } = input;
  const maxPerModel = input.maxAttemptsPerModel ?? 2;
  const maxPerShot = input.maxAttemptsPerShot ?? 4;
  const now = input.now ?? (() => new Date());
  const gen = shot.generation!;
  let attempt = 0;
  let lastReason = "no candidates";

  for (const candidate of chain) {
    const provider = providers.get(candidate.model.providerId);
    if (!provider) continue;

    for (let i = 0; i < maxPerModel && attempt < maxPerShot; i++) {
      attempt++;
      const started = Date.now();
      const base = { productionId: plan.id, shotId: shot.id, attempt, modelKey: candidate.model.key, at: now().toISOString() };

      let jobId: string;
      try {
        ({ jobId } = await provider.submit({
          model: candidate.model,
          prompt: gen.prompt,
          durationSec: gen.durationSec,
          resolution: estimate.resolution,
          aspectRatio: plan.aspectRatio,
          referenceImageUrls: gen.referenceImageUrls,
          audio: gen.audio,
        }));
      } catch (err) {
        if (!(err instanceof ProviderUnavailableError)) throw err;
        ledger.recordAttempt({ ...base, outcome: "unavailable", generatedSec: 0, cost: 0, latencyMs: Date.now() - started, reason: err.message });
        lastReason = err.message;
        break; // provider down → next candidate, don't burn per-model retries
      }

      const status = await waitForJob(provider, jobId, input.pollIntervalMs ?? 2000, input.pollTimeoutMs ?? 10 * 60_000);
      if (status.state === "failed") {
        // Assume a failed job may still be billed; reconcile against provider invoices.
        const cost = attemptCost(candidate.model, estimate.resolution, gen.durationSec, gen.audio);
        ledger.recordAttempt({ ...base, providerJobId: jobId, outcome: "failed", generatedSec: 0, cost, latencyMs: Date.now() - started, reason: status.error });
        telemetry.record(candidate.model.key, { accepted: false, generatedSec: 0, spend: cost });
        lastReason = status.error;
        continue;
      }

      const generatedSec = status.generatedSec ?? Math.ceil(gen.durationSec);
      const cost = status.reportedCost ?? attemptCost(candidate.model, estimate.resolution, gen.durationSec, gen.audio);
      const verdict = await validator.validate(shot, { url: status.outputUrl, generatedSec, modelKey: candidate.model.key });
      ledger.recordAttempt({
        ...base,
        providerJobId: jobId,
        outcome: verdict.pass ? "accepted" : "rejected",
        generatedSec,
        cost,
        latencyMs: Date.now() - started,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      });
      telemetry.record(candidate.model.key, { accepted: verdict.pass, generatedSec, spend: cost });

      if (verdict.pass) {
        return { ok: true, asset: { kind: "generated", url: status.outputUrl, modelKey: candidate.model.key, generatedSec, attempts: attempt } };
      }
      lastReason = verdict.reason ?? "rejected";
    }
    if (attempt >= maxPerShot) break;
  }
  return { ok: false, reason: `${attempt} attempts exhausted; last: ${lastReason}` };
}

type TerminalStatus = Extract<JobStatus, { state: "completed" | "failed" }>;

async function waitForJob(provider: VideoProvider, jobId: string, intervalMs: number, timeoutMs: number): Promise<TerminalStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await provider.poll(jobId);
    if (status.state === "completed" || status.state === "failed") return status;
    if (Date.now() > deadline) return { state: "failed", error: `timed out after ${timeoutMs}ms` };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function runPool(jobs: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      await job();
    }
  });
  await Promise.all(workers);
}
