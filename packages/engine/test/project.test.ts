import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildDesignReveal, figmaToProduct, parseFigmaUrl, reopenProject } from "../src/index.js";

const file = (name: string) => readFileSync(new URL("../../../fixtures/" + name, import.meta.url));
const json = (name: string) => JSON.parse(file(name).toString());
const project = () => figmaToProduct({
  reference: parseFigmaUrl("https://www.figma.com/design/VividFixture/Launchboard?node-id=1-2"),
  nodesResponse: json("design.nodes.json"), captureDataUrl: "data:image/png;base64," + file("design.capture.png").toString("base64"),
  svg: file("design.layers.svg").toString(), brand: json("design.brand.json"), brief: json("design.brief.json"),
});

describe("saved project reopening", () => {
  it("keeps portable assets, source provenance and content without any network request", () => {
    const request = vi.fn(() => { throw new Error("Unexpected network request"); });
    vi.stubGlobal("fetch", request);
    try {
      const original = project();
      const result = reopenProject(original);
      expect(result).toEqual(original);
      expect(result).not.toBe(original);
      expect(request).not.toHaveBeenCalled();
      expect(buildDesignReveal(result).screens[0]!.layerScene).toEqual(original.screens[0]!.layerScene);
    } finally { vi.unstubAllGlobals(); }
  });
  it("applies only explicit brand and brief overrides and leaves the saved project unchanged", () => {
    const original = project(); const before = JSON.stringify(original);
    const brand = { ...original.brand, primary: "#112233" };
    const brief = { ...json("design.brief.json"), productName: "New version", headline: "A new direction." };
    const result = reopenProject(original, { brand, brief });
    expect(JSON.stringify(original)).toBe(before);
    expect(result.brand.primary).toBe("#112233");
    expect(result.copy.headline).toBe("A new direction.");
    expect(result.product.name).toBe("New version");
    expect(result.screens).toEqual(original.screens);
    expect(result.source).toEqual(original.source);
  });
  it("recompiles timing without changing the source design", () => {
    const original = project();
    const plan = buildDesignReveal(reopenProject(original), { pacing: { introSec: 2, overviewSec: 3, focusSec: 2, outroSec: 2 } });
    expect(plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(13);
    expect(plan.screens[0]).toEqual(original.screens[0]);
  });
  it.each(["https://assets.test/frame.png", "file:///tmp/frame.png", "data:image/svg+xml;base64,PHN2Zy8+"])("rejects external or non-PNG frame assets: %s", (captureUrl) => {
    const value = project(); value.screens[0]!.captureUrl = captureUrl;
    expect(() => reopenProject(value)).toThrow("embedded PNG");
  });
  it("rejects malformed embedded captures, dimension mismatches, and invalid brief overrides", () => {
    const badImage = project(); badImage.screens[0]!.captureUrl = "data:image/png;base64,aGVsbG8=";
    expect(() => reopenProject(badImage)).toThrow("embedded PNG");
    const badSize = project(); badSize.screens[0]!.width = 100;
    expect(() => reopenProject(badSize)).toThrow("dimensions");
    const badScene = project(); badScene.screens[0]!.layerScene!.width = 100;
    expect(() => reopenProject(badScene)).toThrow("dimensions");
    expect(() => reopenProject(project(), { brief: { ...json("design.brief.json"), headline: "x".repeat(100) } })).toThrow();
  });
  it("rejects network font and logo dependencies", () => {
    const remoteFont = project(); remoteFont.brand.fontUrl = "https://assets.test/font.woff2";
    expect(() => reopenProject(remoteFont)).toThrow("embedded WOFF2");
    const remoteLogo = project(); remoteLogo.brand.logoUrl = "https://assets.test/logo.png";
    expect(() => reopenProject(remoteLogo)).toThrow("embedded PNG");
  });
});
