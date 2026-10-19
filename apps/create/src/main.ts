import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { BrandKit, PLANS, ProductIR, Region, VideoBrief, frameSize, type PlanId } from "@vivid/core";
import { AnthropicPlanner, OpenAIPlanner, estimateProduction, figmaToProduct, importFigma, ModelTelemetry, parseFigmaUrl, planDesign, reopenProject, type PlanningProvider } from "@vivid/engine";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(["--render", "--help", "--accept-copy", "--layers"]);
const valueFlags = new Set(["--project", "--figma", "--figma-json", "--figma-svg", "--capture", "--brand", "--brief", "--pacing", "--logo", "--font", "--out", "--plan", "--screenshot", "--regions", "--planner", "--planner-model", "--copy-provider", "--copy-model", "--planner-replay", "--direction", "--planner-max-output"]);
const options = new Map<string, string>();

async function main(): Promise<void> {
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (flags.has(name)) { options.set(name, "true"); continue; }
    if (!valueFlags.has(name) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Unknown or incomplete option: ${name}`);
    options.set(name, args[++i]!);
  }
  if (options.has("--help")) {
    console.log("npm run create -- --figma <frame-link> --brand <kit.json> --brief <brief.json> [--render]\n" +
      "Saved project: --project <production-directory-or-product-ir.json> [--pacing <profile.json>] [--render]\n" +
      "Offline export: also pass --figma-json <nodes-response.json> --capture <frame.png>\n" +
      "Layer reconstruction: --layers for live import; offline also requires --figma-svg <outlined-node-tagged.svg>\n" +
      "Screenshot fallback: use --screenshot <frame.png> --regions <regions.json> instead of --figma\n" +
      "Optional: --pacing <profile.json> --logo <logo.png> --font <font.woff2> --plan pro --out <new-directory>\n" +
      "AI planning: --planner openai|anthropic --planner-model <id> [--copy-provider openai|anthropic] [--copy-model <id>]\n" +
      "Review: --planner-replay <suggestions.json> [--accept-copy]. --direction <text> supplies creative direction.");
    return;
  }
  const required = (name: string) => { const v = options.get(name); if (!v) throw new Error(`Missing ${name}; run npm run create -- --help`); return v; };
  const readJson = (path: string) => JSON.parse(readFileSync(resolve(path), "utf8"));
  const inputs = ["--project", "--figma", "--screenshot"].filter((name) => options.has(name));
  if (inputs.length !== 1) throw new Error("Choose exactly one input: --project, --figma, or --screenshot");
  if (options.has("--project") && ["--figma-json", "--figma-svg", "--capture", "--regions", "--layers"].some((name) => options.has(name))) {
    throw new Error("Saved projects already contain their design assets; do not combine --project with import flags");
  }
  const projectPath = options.has("--project") ? resolve(required("--project")) : undefined;
  const saved = projectPath ? ProductIR.parse(readJson(statSync(projectPath).isDirectory() ? resolve(projectPath, "product-ir.json") : projectPath)) : undefined;
  const brand = BrandKit.parse(options.has("--brand") ? readJson(required("--brand")) : saved?.brand ?? readJson(required("--brand")));
  if (options.has("--logo")) brand.logoUrl = readPng(required("--logo")).url;
  if (options.has("--font")) {
    const bytes = readFileSync(resolve(required("--font")));
    if (bytes.length < 4 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== "wOF2") throw new Error("Use a WOFF2 font smaller than 5 MiB");
    brand.fontUrl = `data:font/woff2;base64,${bytes.toString("base64")}`;
  }
  if (brand.logoUrl && !brand.logoUrl.startsWith("data:image/png;base64,")) throw new Error("Use --logo <local.png> for a durable brand logo");
  if (brand.fontUrl && !brand.fontUrl.startsWith("data:font/woff2;base64,")) throw new Error("Use --font <local.woff2> for a durable brand font");
  const brief = VideoBrief.parse(options.has("--brief") ? readJson(required("--brief")) : saved ? {
    productName: saved.product.name, description: saved.product.description, category: saved.product.category,
    headline: saved.copy.headline, subtext: saved.copy.subtext, cta: saved.copy.cta,
  } : readJson(required("--brief")));
  const planId = options.get("--plan") ?? "pro";
  if (!Object.hasOwn(PLANS, planId)) throw new Error(`Unknown account plan: ${planId}`);
  const account = PLANS[planId as PlanId];
  if (options.has("--figma-json") !== options.has("--capture")) throw new Error("Offline import requires both --figma-json and --capture");
  if (options.has("--screenshot") && (options.has("--figma-json") || options.has("--capture"))) throw new Error("Screenshot mode cannot include Figma snapshot options");
  if (options.has("--layers") && options.has("--screenshot")) throw new Error("Layer reconstruction requires structured Figma content, not a screenshot");
  if (options.has("--figma-svg") && (!options.has("--figma-json") || !options.has("--layers"))) throw new Error("--figma-svg requires --layers and --figma-json");
  if (options.has("--layers") && options.has("--figma-json") && !options.has("--figma-svg")) throw new Error("Offline layers require --figma-svg");
  const out = resolve(options.get("--out") ?? `out/design-${Date.now()}`);
  if (existsSync(out)) throw new Error(`Output directory already exists: ${out}. Choose a new --out directory.`);
  const mode = options.get("--planner") ?? "rules";
  if (!["rules", "openai", "anthropic"].includes(mode)) throw new Error("Planner must be rules, openai, or anthropic");
  if ((options.get("--direction")?.length ?? 0) > 500) throw new Error("Direction must be 500 characters or shorter");
  let choreography: PlanningProvider | undefined;
  let copy: PlanningProvider | undefined;
  let replay: { choreography: unknown; copy?: unknown } | undefined;
  if (options.has("--accept-copy") && !options.has("--planner-replay")) throw new Error("Review saved suggestions first; --accept-copy requires --planner-replay");
  if (options.has("--planner-replay")) {
    if (mode !== "rules" || ["--planner-model", "--copy-provider", "--copy-model", "--planner-max-output"].some((flag) => options.has(flag))) throw new Error("Choose replay or live planning options, not both");
    const value = readJson(required("--planner-replay"));
    if (!value || typeof value !== "object" || !Object.hasOwn(value, "choreography") || Object.keys(value).some((k) => !["choreography", "copy"].includes(k))) throw new Error("Replay file must contain choreography and optional copy only");
    replay = value;
  } else if (mode !== "rules") {
    const make = (provider: string, model: string | undefined) => {
      const maxOutputTokens = Number(options.get("--planner-max-output") ?? 2048);
      if (provider === "openai") return new OpenAIPlanner({ apiKey: process.env.OPENAI_API_KEY ?? "", model: model ?? process.env.OPENAI_PLANNER_MODEL ?? "gpt-5.5", maxOutputTokens });
      if (provider === "anthropic") return new AnthropicPlanner({ apiKey: process.env.ANTHROPIC_API_KEY ?? "", model: model ?? process.env.ANTHROPIC_PLANNER_MODEL ?? "claude-sonnet-5", maxOutputTokens });
      throw new Error("Copy provider must be openai or anthropic");
    };
    choreography = make(mode, options.get("--planner-model"));
    const copyProvider = options.get("--copy-provider") ?? mode;
    const copyModel = options.get("--copy-model") ?? (copyProvider === "anthropic" ? process.env.ANTHROPIC_COPY_MODEL ?? "claude-haiku-4-5" : process.env.OPENAI_COPY_MODEL ?? (copyProvider === mode ? choreography.model : "gpt-5.5"));
    copy = make(copyProvider, copyModel);
    console.log(`Live planning enabled: choreography ${choreography.id}/${choreography.model}; copy ${copy.id}/${copy.model}. Up to two paid requests; actual planning spend is not yet priced into the estimate.`);
  } else if (["--planner-model", "--copy-provider", "--copy-model", "--planner-max-output", "--accept-copy"].some((flag) => options.has(flag))) {
    throw new Error("Copy/model options require live planning or --planner-replay");
  }

  let ir: ProductIR;
  let inputMode: string;
  if (saved) {
    ir = reopenProject(saved, { brand, brief });
    inputMode = "saved-project";
  } else if (options.has("--screenshot")) {
    const capture = readPng(required("--screenshot"));
    const rawRegions = readJson(required("--regions"));
    if (!Array.isArray(rawRegions) || !rawRegions.length) throw new Error("Screenshot fallback needs a nonempty array of normalized region annotations");
    ir = ProductIR.parse({
      source: { kind: "screenshot" },
      product: { name: brief.productName, description: brief.description, category: brief.category },
      brand, screens: [{ id: "screenshot", name: brief.productName, captureUrl: capture.url, width: capture.width, height: capture.height, regions: rawRegions.map((r) => Region.parse(r)) }],
      copy: { headline: brief.headline, subtext: brief.subtext, cta: brief.cta },
    });
    inputMode = "annotated-screenshot";
  } else if (options.has("--figma-json")) {
    const capture = readPng(required("--capture"));
    ir = figmaToProduct({ reference: parseFigmaUrl(required("--figma")), nodesResponse: readJson(required("--figma-json")), captureDataUrl: capture.url, brand, brief,
      svg: options.has("--layers") ? readFileSync(resolve(required("--figma-svg")), "utf8") : undefined,
    });
    const screen = ir.screens[0]!;
    if (Math.abs(capture.width / capture.height - screen.width! / screen.height!) > 0.01) throw new Error("Capture aspect ratio does not match the selected Figma frame; export with use_absolute_bounds=true");
    inputMode = "offline-figma-snapshot";
  } else {
    ir = await importFigma({ url: required("--figma"), token: process.env.FIGMA_ACCESS_TOKEN ?? "", brand, brief, layers: options.has("--layers"),
      onSnapshot: ({ nodesResponse, captureDataUrl, svg }) => {
        mkdirSync(out, { recursive: true });
        writeFileSync(resolve(out, "source.nodes.json"), JSON.stringify(nodesResponse));
        writeFileSync(resolve(out, "source.capture.png"), Buffer.from(captureDataUrl.slice("data:image/png;base64,".length), "base64"));
        if (svg) writeFileSync(resolve(out, "source.layers.svg"), svg);
      },
    });
    inputMode = "live-figma";
  }
  const planned = await planDesign(ir, {
    choreography, copy, replay, acceptCopy: options.has("--accept-copy"), direction: options.get("--direction"),
    pacing: options.has("--pacing") ? readJson(required("--pacing")) : undefined,
  });
  const { plan } = planned;
  const estimate = estimateProduction({ plan, account, route: { catalog: [], telemetry: new ModelTelemetry(), availableProviders: new Set() } });
  const props = { plan, ...frameSize(estimate.resolution, plan.aspectRatio), assets: Object.fromEntries(plan.shots.map((s) => [s.id, { kind: "deterministic" }])) };
  mkdirSync(out, { recursive: true });
  const write = (name: string, value: unknown) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + "\n");
  write("product-ir.json", ir);
  if (ir.screens[0]?.layerScene) write("layer-report.json", {
    mode: "figma-svg-layers", outlineText: true, animatedLayerCount: ir.screens[0].layerScene.layers.length,
    layers: ir.screens[0].layerScene.layers.map(({ nodeId, kind }) => ({ nodeId, kind })),
    limit: "Up to 120 disjoint content nodes animate; other vector content retains its original appearance. SVG effects remain as exported, and text outlines are not editable text.",
  });
  write("render-props.json", props);
  write("estimate.json", { ...estimate, planningCost: {
    basis: "configured-placeholder", confirmed: false,
    reconciliationRequired: planned.audit.spendStatus === "unpriced-provider-usage",
    note: "The engine planning allowance is an assumption, not measured provider spend. See planning.json for token usage.",
  } });
  write("planning.json", planned.audit);
  write("planner-suggestions.json", { choreography: planned.choreography ?? null, copy: planned.copySuggestion ?? null });
  const manifest = { status: "planned", inputMode, productionId: plan.id, output: null as string | null, usageCharged: false };
  write("production.json", manifest);
  console.log(`${brief.productName}: ${estimate.durationSec.toFixed(1)}s, ${estimate.resolution}, ${plan.shots.length} shots, ${estimate.buildMinutes.toFixed(1)} estimated Build Minutes. Local run: no usage charged.`);
  console.log(`Input: ${inputMode}. Plan and quote: ${out}`);
  console.log(`Planning: ${planned.audit.mode}; choreography ${planned.audit.choreography.source}; copy ${planned.audit.copy.source}${planned.audit.copyAccepted ? " (accepted)" : " (original copy retained)"}.`);
  if (planned.audit.copyReviewRequired) console.log("Review planner-suggestions.json. To use approved suggestions without another API call, rerun with --planner-replay <that-file> --accept-copy and a new --out directory.");
  if (!options.has("--render")) return;
  const output = resolve(out, "video.mp4");
  const cli = resolve(dirname(fileURLToPath(import.meta.resolve("@remotion/cli/package.json"))), "remotion-cli.js");
  manifest.status = "rendering"; write("production.json", manifest);
  const rendered = spawnSync(process.execPath, [cli, "render", "src/index.ts", "Vivid", output, `--props=${resolve(out, "render-props.json")}`], {
    cwd: resolve(root, "packages/renderer"), stdio: "inherit",
  });
  if (rendered.error || rendered.status !== 0 || !existsSync(output) || statSync(output).size === 0) {
    manifest.status = "failed"; write("production.json", manifest);
    throw new Error("Render failed. The saved production is marked failed and no customer usage was charged.");
  }
  manifest.status = "rendered"; manifest.output = output; write("production.json", manifest);
  console.log(`Rendered: ${output}`);
}

function readPng(path: string): { url: string; width: number; height: number } {
  const bytes = readFileSync(resolve(path));
  if (bytes.length < 24 || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Use a PNG image smaller than 20 MiB");
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error("PNG has invalid dimensions");
  return { url: `data:image/png;base64,${bytes.toString("base64")}`, width, height };
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Creation failed"); process.exitCode = 1; });
