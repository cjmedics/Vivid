import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLANS, ProductIR, formatUsd, frameSize, type PlanId } from "@vivid/core";
import {
  DEFAULT_CATALOG,
  DurationValidator,
  InMemoryLedger,
  MockProvider,
  ModelTelemetry,
  STYLES,
  SeededQualityValidator,
  ValidatorChain,
  buildFeatureReveal,
  estimateProduction,
  executeProduction,
  quoteRefinement,
  type ProviderId,
  type ProviderRegistry,
  type StyleId,
} from "@vivid/engine";

/**
 * End-to-end walkthrough on mock providers: plan → estimate → execute → cost report.
 *   npm run demo                      Pro, Minimal, Production
 *   npm run demo -- --style cinematic --plan studio
 *   npm run demo -- --outage          OpenRouter down, router falls back
 *   npm run demo -- --write-plan      also writes Remotion props for `npm run render:demo`
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ir = ProductIR.parse(JSON.parse(readFileSync(root("fixtures/ledgerly.ir.json"), "utf8")));

const planId = option("plan", "pro") as PlanId;
const styleId = option("style", "minimal") as StyleId;
const account = PLANS[planId];
const quality = account.qualityModes.includes("production") ? "production" : "draft";

const providers: ProviderRegistry = new Map<ProviderId, MockProvider>([
  ["openrouter", new MockProvider("openrouter", { failureRate: 0.05, unavailable: flag("outage"), seed: 3 })],
  ["higgsfield", new MockProvider("higgsfield", { failureRate: 0.05, seed: 4 })],
  ["google", new MockProvider("google", { seed: 5 })],
]);
const telemetry = new ModelTelemetry();
const routeDeps = { catalog: DEFAULT_CATALOG, telemetry, availableProviders: new Set(providers.keys()) };
const tierOf = (key: string) => DEFAULT_CATALOG.find((m) => m.key === key)?.tier ?? "efficient";
const validator = new ValidatorChain([
  new DurationValidator(),
  new SeededQualityValidator((key) => ({ efficient: 0.25, balanced: 0.15, premium: 0.1 })[tierOf(key)], 11),
]);

// ── Plan + estimate (cost doc §21) ────────────────────────────────────────
const plan = buildFeatureReveal(ir, { styleId, quality, aspectRatio: "16:9", id: "prod-8291" });
const estimate = estimateProduction({ plan, account, route: routeDeps });
const pct = (n: number) => `${Math.round(n * 100)}%`;

box(`Create Feature Video — ${account.displayName} plan`, [
  `Preset          Feature Reveal`,
  `Style           ${STYLES[styleId].displayName}`,
  `Duration        ${estimate.durationSec.toFixed(1)} sec`,
  `Output          ${estimate.resolution}`,
  ``,
  `Estimated production`,
  `Build Minutes   ${estimate.buildMinutes.toFixed(1)}`,
  `Refinements     ${estimate.refinementUnitsSuggested} suggested`,
  `Deterministic   ${pct(estimate.deterministicShare)}`,
  `Generative      ${pct(1 - estimate.deterministicShare)}`,
  `Route           Auto`,
]);

console.log("Routing decisions (internal)");
for (const r of estimate.routes) {
  const shot = plan.shots.find((s) => s.id === r.shotId)!;
  console.log(
    r.kind === "deterministic"
      ? `  ${shot.id} ${shot.beat.padEnd(20)} Remotion`
      : `  ${shot.id} ${shot.beat.padEnd(20)} ${r.primary.model.displayName} via ${r.primary.model.providerId} — ${formatUsd(r.primary.effectivePerAcceptedSec, 4)}/accepted s (${r.reason}; ${r.chain.length} fallbacks)`,
  );
}

// ── Execute ───────────────────────────────────────────────────────────────
const ledger = new InMemoryLedger();
ledger.openAccount("acct-demo", planId);
const result = await executeProduction({
  accountId: "acct-demo",
  plan,
  estimate,
  ledger,
  providers,
  validator,
  telemetry,
  concurrency: account.maxConcurrentGenerations,
  pollIntervalMs: 0,
});
const report = ledger.costReport(plan.id);
const usage = ledger.usage("acct-demo");

// ── Customer view (cost doc §22) ─────────────────────────────────────────
const modelsUsed = new Set(["Remotion"]);
for (const a of Object.values(result.assets)) {
  if (a.kind === "generated") modelsUsed.add(DEFAULT_CATALOG.find((m) => m.key === a.modelKey)!.displayName);
}
box(result.status === "completed" ? "Production complete" : "Production failed — nothing charged", [
  `${estimate.durationSec.toFixed(1)} seconds · ${estimate.resolution}`,
  `${new Set(plan.shots.map((s) => s.sceneId)).size} scenes · ${plan.shots.length} shots`,
  `Deterministic   ${estimate.deterministicSec.toFixed(1)}s`,
  `Generated       ${estimate.generativeSec.toFixed(1)}s`,
  `Models used     ${[...modelsUsed].join(", ")}`,
  `Build usage     ${result.chargedBuildMinutes.toFixed(1)} min (${usage.buildMinutes.available.toFixed(1)} left)`,
  `Refinements     ${usage.refinementUnits.available} available`,
  ...result.failedShots.map((f) => `FAILED ${f.shotId}: ${f.reason}`),
]);

// ── Admin view (cost doc §23) ────────────────────────────────────────────
console.log(`ADMIN — PRODUCTION #${plan.id}`);
console.log(`  Generation       ${formatUsd(report.generation, 3)}   (estimated ${formatUsd(estimate.internal.generation, 3)})`);
console.log(`  Retries          ${formatUsd(report.retries, 3)}   (estimated ${formatUsd(estimate.internal.expectedRetries, 3)})`);
for (const [k, v] of Object.entries(report.fixed)) console.log(`  ${k.padEnd(16)} ${formatUsd(v, 3)}`);
console.log(`  TOTAL            ${formatUsd(report.total, 3)}   (estimated ${formatUsd(estimate.internal.total, 3)})`);
console.log(`  Effective/sec    ${formatUsd(Math.round(report.total / estimate.durationSec), 4)}`);
console.log(`  Revenue/BM       ${formatUsd(revenuePerBuildMinute(planId))}  → gross margin ${margin(planId, result.chargedBuildMinutes, report.total)}`);
for (const m of report.byModel) {
  console.log(`  ${m.modelKey}`);
  console.log(`    calls ${m.calls} · accepted ${m.accepted} · rejected ${m.rejected} · failed ${m.failed} · ${m.generatedSec}s · ${formatUsd(m.spend, 3)} · acceptance ${pct(m.acceptanceRate)}`);
}

// ── Refinement quotes (cost doc §8) ──────────────────────────────────────
console.log("\nRefinement quotes");
const deterministicShot = plan.shots.find((s) => s.mode === "deterministic")!;
const generatedShot = plan.shots.find((s) => s.generation);
const quotes = [
  { label: `"Make the zoom slower" (${deterministicShot.id})`, q: quoteRefinement({ kind: "minor", affectedShots: [deterministicShot], account, quality, route: routeDeps }) },
  ...(generatedShot
    ? [{ label: `"Regenerate the intro backdrop" (${generatedShot.id})`, q: quoteRefinement({ kind: "shot", affectedShots: [generatedShot], account, quality, route: routeDeps }) }]
    : []),
];
for (const { label, q } of quotes) console.log(`  ${label.padEnd(44)} ${q.units} RU  (internal ${formatUsd(q.internalCost, 3)}, ${q.chargeBasis})`);

// ── Pricing sanity matrix ───────────────────────────────────────────────
console.log("\nMargin check — Feature Reveal, ~37s, each plan's best mode");
console.log("  plan      style      res    BM    internal   revenue   margin   basis");
for (const pid of ["starter", "pro", "studio"] as const) {
  const acct = PLANS[pid];
  const q = acct.qualityModes.includes("production") ? "production" : "draft";
  for (const sid of Object.keys(STYLES) as StyleId[]) {
    const p = buildFeatureReveal(ir, { styleId: sid, quality: q, aspectRatio: "16:9", id: `m-${pid}-${sid}` });
    const e = estimateProduction({ plan: p, account: acct, route: { ...routeDeps, telemetry: new ModelTelemetry() } });
    const revenue = revenuePerBuildMinute(pid) * e.buildMinutes;
    console.log(
      `  ${pid.padEnd(9)} ${sid.padEnd(10)} ${e.resolution.padEnd(6)} ${e.buildMinutes.toFixed(1).padStart(4)}  ${formatUsd(e.internal.total, 3).padStart(8)}   ${formatUsd(revenue).padStart(7)}   ${margin(pid, e.buildMinutes, e.internal.total).padStart(5)}   ${e.chargeBasis}`,
    );
  }
}
console.log("  (revenue = plan price ÷ included Build Minutes × minutes charged; assumes full allowance use)");

if (flag("write-plan")) {
  const out = root("fixtures/render-props.generated.json");
  writeFileSync(out, JSON.stringify({ plan, ...frameSize(estimate.resolution, plan.aspectRatio), assets: result.assets }, null, 2));
  console.log(`\nWrote ${out}`);
}

function revenuePerBuildMinute(pid: PlanId): number {
  const p = PLANS[pid];
  return p.priceUsdCents === null ? 0 : Math.round((p.priceUsdCents * 10_000) / p.buildMinutes);
}

function margin(pid: PlanId, buildMinutes: number, cost: number): string {
  const revenue = revenuePerBuildMinute(pid) * buildMinutes;
  return revenue > 0 ? pct((revenue - cost) / revenue) : "n/a";
}

function box(title: string, lines: string[]) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 2;
  console.log(`┌${"─".repeat(width + 2)}┐`);
  console.log(`│ ${title.padEnd(width)} │`);
  console.log(`│ ${"".padEnd(width)} │`);
  for (const l of lines) console.log(`│ ${l.padEnd(width)} │`);
  console.log(`└${"─".repeat(width + 2)}┘\n`);
}
