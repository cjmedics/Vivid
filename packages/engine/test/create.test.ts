import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = ["--import", "tsx", "apps/create/src/main.ts"];
const common = ["--brand", "fixtures/design.brand.json", "--brief", "fixtures/design.brief.json"];
const figma = ["--figma", "https://www.figma.com/design/VividFixture/Launchboard?node-id=1-2", "--figma-json", "fixtures/design.nodes.json", "--capture", "fixtures/design.capture.png"];

describe("create command", () => {
  it("reopens a saved production without credentials, import files, or network access", () => {
    const temp = mkdtempSync(join(tmpdir(), "vivid-project-"));
    try {
      const original = join(temp, "original");
      execFileSync(process.execPath, [...cli, ...common, ...figma, "--layers", "--figma-svg", "fixtures/design.layers.svg", "--out", original], { cwd: root });
      const sourcePath = join(original, "product-ir.json");
      const before = readFileSync(sourcePath, "utf8");
      const denyNetwork = join(temp, "deny-network.mjs");
      writeFileSync(denyNetwork, 'globalThis.fetch = () => { throw new Error("Unexpected network access"); };');
      const pacing = join(temp, "pacing.json");
      writeFileSync(pacing, JSON.stringify({ introSec: 2, overviewSec: 3, focusSec: 2, outroSec: 2 }));
      const out = join(temp, "reopened");
      execFileSync(process.execPath, ["--import", denyNetwork, ...cli, "--project", original, "--pacing", pacing, "--out", out], {
        cwd: root, env: { ...process.env, FIGMA_ACCESS_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
      });
      const ir = JSON.parse(readFileSync(join(out, "product-ir.json"), "utf8"));
      const props = JSON.parse(readFileSync(join(out, "render-props.json"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(out, "production.json"), "utf8"));
      const audit = JSON.parse(readFileSync(join(out, "planning.json"), "utf8"));
      expect(ir).toEqual(JSON.parse(before));
      expect(readFileSync(sourcePath, "utf8")).toBe(before);
      expect(props.plan.shots.reduce((sum: number, shot: { durationSec: number }) => sum + shot.durationSec, 0)).toBe(13);
      expect(manifest).toMatchObject({ inputMode: "saved-project", status: "planned", usageCharged: false });
      expect(audit.spendStatus).toBe("no-live-calls");
      const fromFile = join(temp, "from-file");
      execFileSync(process.execPath, [...cli, "--project", sourcePath, "--out", fromFile], { cwd: root });
      expect(JSON.parse(readFileSync(join(fromFile, "product-ir.json"), "utf8"))).toEqual(ir);
      const briefPath = join(temp, "brief.json");
      const customBrief = JSON.parse(readFileSync(join(root, "fixtures/design.brief.json"), "utf8"));
      customBrief.headline = "A fresh direction.";
      writeFileSync(briefPath, JSON.stringify(customBrief));
      const overridden = join(temp, "overridden");
      execFileSync(process.execPath, [...cli, "--project", sourcePath, "--brief", briefPath, "--out", overridden], { cwd: root });
      const overrideIR = JSON.parse(readFileSync(join(overridden, "product-ir.json"), "utf8"));
      expect(overrideIR.copy.headline).toBe("A fresh direction.");
      expect(overrideIR.screens).toEqual(ir.screens);
      expect(overrideIR.source).toEqual(ir.source);
      const overwrite = spawnSync(process.execPath, [...cli, "--project", original, "--out", original], { cwd: root, encoding: "utf8" });
      expect(overwrite.status).toBe(1);
      expect(overwrite.stderr).toContain("already exists");
      expect(readFileSync(sourcePath, "utf8")).toBe(before);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("rejects ambiguous project/import modes before opening inputs", () => {
    for (const flags of [
      ["--project", "missing", "--figma", "missing"],
      ["--project", "missing", "--screenshot", "missing"],
      ["--project", "missing", "--layers"],
      ["--project", "missing", "--figma-json", "missing"],
    ]) {
      const result = spawnSync(process.execPath, [...cli, ...flags], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Choose exactly one input|already contain their design assets/);
    }
  });
  it("persists a layer scene and source-node report for offline reconstruction", () => {
    const temp = mkdtempSync(join(tmpdir(), "vivid-layered-"));
    try {
      const out = join(temp, "production");
      execFileSync(process.execPath, [...cli, ...common, ...figma, "--layers", "--figma-svg", "fixtures/design.layers.svg", "--out", out], { cwd: root });
      const props = JSON.parse(readFileSync(join(out, "render-props.json"), "utf8"));
      const report = JSON.parse(readFileSync(join(out, "layer-report.json"), "utf8"));
      expect(props.plan.screens[0].layerScene.root.tag).toBe("svg");
      expect(report.animatedLayerCount).toBeGreaterThan(1);
      expect(report.layers.some((l: { kind: string }) => l.kind === "text")).toBe(true);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("writes a portable plan and quote without billing; refuses to overwrite a prior production", () => {
    const temp = mkdtempSync(join(tmpdir(), "vivid-create-"));
    try {
      const out = join(temp, "production");
      execFileSync(process.execPath, [...cli, ...common, ...figma, "--out", out], { cwd: root });
      const props = JSON.parse(readFileSync(join(out, "render-props.json"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(out, "production.json"), "utf8"));
      expect(props.plan.source).toMatchObject({ kind: "figma", version: "fixture-v1" });
      expect(props.plan.screens[0].captureUrl).toMatch(/^data:image\/png;base64,/);
      expect(props.width).toBe(1920);
      expect(manifest).toMatchObject({ status: "planned", usageCharged: false, inputMode: "offline-figma-snapshot" });
      const again = spawnSync(process.execPath, [...cli, ...common, ...figma, "--out", out], { cwd: root, encoding: "utf8" });
      expect(again.status).toBe(1);
      expect(again.stderr).toContain("already exists");
      expect(JSON.parse(readFileSync(join(out, "production.json"), "utf8"))).toEqual(manifest);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("accepts annotated screenshots without requiring a Figma token or inventing provenance", () => {
    const temp = mkdtempSync(join(tmpdir(), "vivid-screenshot-"));
    try {
      const regions = join(temp, "regions.json");
      writeFileSync(regions, JSON.stringify([{ id: "card", kind: "card", label: "Plan the work", bbox: { x: 0.21, y: 0.328, w: 0.2267, h: 0.4907 }, focalScore: 0.8 }]));
      const out = join(temp, "production");
      execFileSync(process.execPath, [...cli, ...common, "--screenshot", "fixtures/design.capture.png", "--regions", regions, "--plan", "starter", "--out", out], { cwd: root });
      const props = JSON.parse(readFileSync(join(out, "render-props.json"), "utf8"));
      expect(props.plan.source).toEqual({ kind: "screenshot" });
      expect(props.width).toBe(1280);
      expect(props.plan.shots).toHaveLength(4);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("rejects missing live credentials before consuming API quota", () => {
    const result = spawnSync(process.execPath, [...cli, ...common, "--figma", "https://www.figma.com/design/abc/Design?node-id=1-2"], {
      cwd: root, encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FIGMA_ACCESS_TOKEN");
  });
  it("replays reviewed suggestions without live credentials and records the chosen copy", () => {
    const temp = mkdtempSync(join(tmpdir(), "vivid-replay-"));
    try {
      const out = join(temp, "production");
      execFileSync(process.execPath, [...cli, ...common, ...figma, "--planner-replay", "fixtures/planner.suggestions.json", "--accept-copy", "--out", out], {
        cwd: root, env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
      });
      const audit = JSON.parse(readFileSync(join(out, "planning.json"), "utf8"));
      const props = JSON.parse(readFileSync(join(out, "render-props.json"), "utf8"));
      expect(audit).toMatchObject({ mode: "replay", copyAccepted: true, spendStatus: "no-live-calls" });
      expect(props.plan.copy.headline).toBe("Your next launch, brought into focus.");
      expect(props.plan.shots[2].primitives[1].targetRegionId).toBe("3:3");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("rejects missing planner credentials before a live Figma import", () => {
    const result = spawnSync(process.execPath, [...cli, ...common, "--figma", "https://www.figma.com/design/abc/Design?node-id=1-2", "--planner", "openai"], {
      cwd: root, encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "", FIGMA_ACCESS_TOKEN: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Planner API key is missing");
  });
});
