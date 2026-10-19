import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { BrandKit, PLANS, ProductIR, Region, VideoBrief, frameSize, type PlanId } from "@vivid/core";
import { buildDesignReveal, estimateProduction, figmaToProduct, importFigma, ModelTelemetry, parseFigmaUrl } from "@vivid/engine";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(["--render", "--help"]);
const valueFlags = new Set(["--figma", "--figma-json", "--capture", "--brand", "--brief", "--pacing", "--logo", "--font", "--out", "--plan", "--screenshot", "--regions"]);
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
      "Offline export: also pass --figma-json <nodes-response.json> --capture <frame.png>\n" +
      "Screenshot fallback: use --screenshot <frame.png> --regions <regions.json> instead of --figma\n" +
      "Optional: --pacing <profile.json> --logo <logo.png> --font <font.woff2> --plan pro --out <new-directory>");
    return;
  }
  const required = (name: string) => { const v = options.get(name); if (!v) throw new Error(`Missing ${name}; run npm run create -- --help`); return v; };
  const readJson = (path: string) => JSON.parse(readFileSync(resolve(path), "utf8"));
  const brand = BrandKit.parse(readJson(required("--brand")));
  if (options.has("--logo")) brand.logoUrl = readPng(required("--logo")).url;
  if (options.has("--font")) {
    const bytes = readFileSync(resolve(required("--font")));
    if (bytes.length < 4 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== "wOF2") throw new Error("Use a WOFF2 font smaller than 5 MiB");
    brand.fontUrl = `data:font/woff2;base64,${bytes.toString("base64")}`;
  }
  if (brand.logoUrl && !brand.logoUrl.startsWith("data:image/png;base64,")) throw new Error("Use --logo <local.png> for a durable brand logo");
  if (brand.fontUrl && !brand.fontUrl.startsWith("data:font/woff2;base64,")) throw new Error("Use --font <local.woff2> for a durable brand font");
  const brief = VideoBrief.parse(readJson(required("--brief")));
  const planId = options.get("--plan") ?? "pro";
  if (!Object.hasOwn(PLANS, planId)) throw new Error(`Unknown account plan: ${planId}`);
  const account = PLANS[planId as PlanId];
  if (options.has("--screenshot") === options.has("--figma")) throw new Error("Choose exactly one input: --figma or --screenshot");
  if (options.has("--figma-json") !== options.has("--capture")) throw new Error("Offline import requires both --figma-json and --capture");
  if (options.has("--screenshot") && (options.has("--figma-json") || options.has("--capture"))) throw new Error("Screenshot mode cannot include Figma snapshot options");
  const out = resolve(options.get("--out") ?? `out/design-${Date.now()}`);
  if (existsSync(out)) throw new Error(`Output directory already exists: ${out}. Choose a new --out directory.`);

  let ir: ProductIR;
  let inputMode: string;
  if (options.has("--screenshot")) {
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
    ir = figmaToProduct({ reference: parseFigmaUrl(required("--figma")), nodesResponse: readJson(required("--figma-json")), captureDataUrl: capture.url, brand, brief });
    const screen = ir.screens[0]!;
    if (Math.abs(capture.width / capture.height - screen.width! / screen.height!) > 0.01) throw new Error("Capture aspect ratio does not match the selected Figma frame; export with use_absolute_bounds=true");
    inputMode = "offline-figma-snapshot";
  } else {
    ir = await importFigma({ url: required("--figma"), token: process.env.FIGMA_ACCESS_TOKEN ?? "", brand, brief });
    inputMode = "live-figma";
  }
  const plan = buildDesignReveal(ir, { pacing: options.has("--pacing") ? readJson(required("--pacing")) : undefined });
  const estimate = estimateProduction({ plan, account, route: { catalog: [], telemetry: new ModelTelemetry(), availableProviders: new Set() } });
  const props = { plan, ...frameSize(estimate.resolution, plan.aspectRatio), assets: Object.fromEntries(plan.shots.map((s) => [s.id, { kind: "deterministic" }])) };
  mkdirSync(out, { recursive: true });
  const write = (name: string, value: unknown) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + "\n");
  write("product-ir.json", ir);
  write("render-props.json", props);
  write("estimate.json", estimate);
  const manifest = { status: "planned", inputMode, productionId: plan.id, output: null as string | null, usageCharged: false };
  write("production.json", manifest);
  console.log(`${brief.productName}: ${estimate.durationSec.toFixed(1)}s, ${estimate.resolution}, ${plan.shots.length} shots, ${estimate.buildMinutes.toFixed(1)} estimated Build Minutes. Local run: no usage charged.`);
  console.log(`Input: ${inputMode}. Plan and quote: ${out}`);
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
