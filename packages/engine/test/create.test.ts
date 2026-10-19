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
