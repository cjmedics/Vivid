import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BrandKit, PacingProfile, validateShotPlan } from "@vivid/core";
import { buildDesignReveal, figmaToProduct, importFigma, parseFigmaUrl } from "../src/index.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const brand = fixture("design.brand.json");
const brief = fixture("design.brief.json");
const png = readFileSync(new URL("../../../fixtures/design.capture.png", import.meta.url));
const captureDataUrl = `data:image/png;base64,${png.toString("base64")}`;
const url = "https://www.figma.com/design/VividFixture/Launchboard?node-id=1-2";
const reference = parseFigmaUrl(url);
const input = () => ({ reference, nodesResponse: fixture("design.nodes.json"), captureDataUrl, brand, brief });

describe("Figma design ingestion", () => {
  it("parses selected-frame links and strips unrelated query parameters", () => {
    expect(parseFigmaUrl(`${url}&t=private-tracking-code`)).toEqual({ fileKey: "VividFixture", nodeId: "1:2", url: "https://www.figma.com/design/VividFixture/?node-id=1%3A2" });
    expect(parseFigmaUrl("https://figma.com/file/abc/title?node-id=12%3A34").nodeId).toBe("12:34");
  });
  it.each(["https://figma.com.evil.test/design/abc?node-id=1-2", "http://figma.com/design/abc?node-id=1-2", "https://figma.com/design/abc", "https://figma.com/proto/abc?node-id=1-2"])("rejects unsupported reference %s", (v) => {
    expect(() => parseFigmaUrl(v)).toThrow();
  });
  it("keeps provenance, visible content, relative coordinates, and user-supplied branding", () => {
    const ir = figmaToProduct(input());
    expect(ir.source).toMatchObject({ kind: "figma", fileKey: "VividFixture", nodeId: "1:2", version: "fixture-v1" });
    const r = ir.screens[0]!.regions.find((r) => r.id === "3:1")!;
    expect(r.bbox.x).toBeCloseTo(252 / 1200);
    expect(r.bbox.y).toBeCloseTo(246 / 750);
    expect(r.bbox.w).toBeCloseTo(272 / 1200);
    expect(r.sourceNodeId).toBe("3:1");
    expect(ir.screens[0]!.regions.some((r) => r.id === "4:1")).toBe(false);
    expect(ir.screens[0]!.regions.every((r) => r.valueAfter === undefined)).toBe(true);
    expect(ir.brand).toEqual(brand);
  });
  it("excludes hidden subtrees and fully off-frame layers; clips partially visible regions", () => {
    const v = input(); const frame = v.nodesResponse.nodes["1:2"].document;
    frame.children[3].visible = false;
    frame.children.push({ id: "outside", name: "Card", type: "FRAME", absoluteBoundingBox: { x: -100, y: -100, width: 20, height: 20 } });
    frame.children.push({ id: "partial", name: "Card", type: "FRAME", absoluteBoundingBox: { x: 50, y: 200, width: 100, height: 100 } });
    const regions = figmaToProduct(v).screens[0]!.regions;
    expect(regions.some((r) => ["3:1", "4:1", "outside"].includes(r.id))).toBe(false);
    expect(regions.find((r) => r.id === "partial")!.bbox).toMatchObject({ x: 0, y: 0, w: 50 / 1200 });
  });
  it("rejects missing or unrenderable frames and incorrectly sized captures", () => {
    const missing = input(); missing.nodesResponse.nodes["1:2"] = null;
    expect(() => figmaToProduct(missing)).toThrow("must select a frame");
    const hidden = input(); hidden.nodesResponse.nodes["1:2"].document.visible = false;
    expect(() => figmaToProduct(hidden)).toThrow("empty or hidden");
    const wrongRatio = input(); wrongRatio.nodesResponse.nodes["1:2"].document.absoluteBoundingBox.width = 750;
    expect(() => figmaToProduct(wrongRatio)).toThrow("aspect ratio");
  });
  it("does not highlight content hidden by a clipping ancestor", () => {
    const v = input();
    v.nodesResponse.nodes["1:2"].document.children.push({
      id: "clipping", name: "Container", type: "FRAME", clipsContent: true,
      absoluteBoundingBox: { x: 100, y: 200, width: 100, height: 100 },
      children: [{ id: "clipped", name: "Card", type: "FRAME", absoluteBoundingBox: { x: 300, y: 400, width: 50, height: 50 } }],
    });
    expect(figmaToProduct(v).screens[0]!.regions.some((r) => r.id === "clipped")).toBe(false);
  });
  it("validates explicit brand colors and input pacing", () => {
    expect(() => BrandKit.parse({ ...brand, primary: "blue" })).toThrow();
    expect(() => PacingProfile.parse({ focusSec: -2 })).toThrow();
  });
  it("imports through the documented API and materializes the image without forwarding credentials", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(input().nodesResponse))
      .mockResolvedValueOnce(Response.json({ images: { "1:2": "https://assets.figma.test/frame.png" } }))
      .mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png" } }));
    const ir = await importFigma({ url, token: "test-secret", brand, brief, fetch: request });
    expect(request.mock.calls[0]![0]).toBe("https://api.figma.com/v1/files/VividFixture/nodes?ids=1%3A2");
    expect(String(request.mock.calls[1]![0])).toContain("use_absolute_bounds=true&version=fixture-v1");
    expect(request.mock.calls[0]![1]?.headers).toEqual({ "X-Figma-Token": "test-secret" });
    expect(request.mock.calls[2]![1]?.headers).toBeUndefined();
    expect(ir.screens[0]!.captureUrl).toBe(captureDataUrl);
    expect(JSON.stringify(ir)).not.toContain("test-secret");
  });
  it.each([403, 429])("reports HTTP %s without retrying blindly or exposing provider response bodies", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider body", { status, headers: { "retry-after": "60" } }));
    await expect(importFigma({ url, token: "test-secret", brand, brief, fetch: request })).rejects.toMatchObject({ status });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects missing exports and non-PNG output", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(input().nodesResponse))
      .mockResolvedValueOnce(Response.json({ images: { "1:2": null } }));
    await expect(importFigma({ url, token: "token", brand, brief, fetch: request })).rejects.toThrow("could not export");
    const badImage = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(input().nodesResponse))
      .mockResolvedValueOnce(Response.json({ images: { "1:2": "https://assets.figma.test/frame.png" } }))
      .mockResolvedValueOnce(new Response("not an image"));
    await expect(importFigma({ url, token: "token", brand, brief, fetch: badImage })).rejects.toThrow("not a PNG");
  });
});

describe("Design Reveal contracts", () => {
  const makePlan = () => buildDesignReveal(figmaToProduct(input()), { id: "design-test" });
  it("plans a bounded, fully deterministic reveal without metric or interaction inventions", () => {
    const plan = makePlan();
    expect(plan.shots).toHaveLength(6);
    expect(plan.shots.every((s) => s.mode === "deterministic" && !s.generation)).toBe(true);
    expect(plan.shots.flatMap((s) => s.primitives).some((p) => /cursor-click|counter-tick|chart-grow/.test(p.primitiveId))).toBe(false);
    expect(plan.shots.reduce((sum, s) => sum + s.durationSec, 0)).toBe(19);
    expect(() => validateShotPlan(plan)).not.toThrow();
  });
  it.each(["target", "timing", "primitive", "duplicates", "capture-data"])("rejects an invalid %s before rendering", (problem) => {
    const plan = makePlan(); const p = plan.shots[2]!.primitives[1]!;
    if (problem === "target") p.targetRegionId = "missing";
    if (problem === "timing") p.durationSec = 100;
    if (problem === "primitive") p.primitiveId = "nonexistent";
    if (problem === "duplicates") plan.shots[1]!.id = plan.shots[0]!.id;
    if (problem === "capture-data") p.primitiveId = "data/counter-tick";
    expect(() => validateShotPlan(plan)).toThrow();
  });
});
