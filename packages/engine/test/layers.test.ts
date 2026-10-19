import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { LayerScene, layerPose, validateShotPlan } from "@vivid/core";
import { buildDesignReveal, figmaToProduct, importFigma, parseFigmaUrl, reconstructLayers } from "../src/index.js";

const read = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url));
const nodes = () => JSON.parse(read("design.nodes.json").toString());
const svg = read("design.layers.svg").toString();
const brand = JSON.parse(read("design.brand.json").toString());
const brief = JSON.parse(read("design.brief.json").toString());
const url = "https://www.figma.com/design/VividFixture/Launchboard?node-id=1-2";
const captureDataUrl = `data:image/png;base64,${read("design.capture.png").toString("base64")}`;
const scene = () => reconstructLayers(svg, nodes().nodes["1:2"].document);

describe("Figma layer reconstruction", () => {
  it("keeps original source geometry, SVG structure, and disjoint text/component nodes", () => {
    const s = scene();
    expect(s.root.tag).toBe("svg");
    expect(s).toMatchObject({ width: 1200, height: 750 });
    expect(s.layers.find((l) => l.nodeId === "2:3")).toMatchObject({ kind: "text", x: 252, y: 126, width: 850, height: 42 });
    expect(s.layers.some((l) => l.nodeId === "3:1" && l.kind === "component")).toBe(true);
    expect(s.layers.some((l) => l.nodeId === "4:1")).toBe(false);
    expect(JSON.stringify(s.root)).toContain("Plan the work"); // Child content survives without a second entrance.
  });
  it("ignores hidden source nodes and keeps mask/clip definitions static", () => {
    const response = nodes(); response.nodes["1:2"].document.children[2].visible = false;
    const s = reconstructLayers(svg, response.nodes["1:2"].document);
    expect(s.layers.some((l) => l.nodeId === "2:3")).toBe(false);
    const defs = svg.replace('<g data-node-id="2:3">', '<defs><g data-node-id="2:3">').replace('your next big idea.</text></g>', 'your next big idea.</text></g></defs>');
    expect(reconstructLayers(defs, nodes().nodes["1:2"].document).layers.some((l) => l.nodeId === "2:3")).toBe(false);
  });
  it.each([
    svg.replace('<g data-node-id="1:2">', '<script>alert(1)</script><g data-node-id="1:2">'),
    svg.replace('fill="none"', 'onload="alert(1)"'),
    svg.replace('fill="none"', 'fill="url(https://external.test/image)"'),
    svg.replace('<g data-node-id="1:2">', '<image href="https://external.test/photo.png"/><g data-node-id="1:2">'),
    svg.replace('<g data-node-id="1:2">', '<foreignObject/><g data-node-id="1:2">'),
    svg.replace('<svg ', '<!DOCTYPE svg [<!ENTITY x "test">]><svg '),
    svg.replace('viewBox="0 0 1200 750"', 'viewBox="0 0 100 100"'),
  ])("rejects unsupported, executable, external, or mismatched exports", (value) => {
    expect(() => reconstructLayers(value, nodes().nodes["1:2"].document)).toThrow();
  });
  it("preserves gradients, nested transforms, opacity, clipping, and embedded images", () => {
    const response = nodes(); const frame = response.nodes["1:2"].document;
    frame.children.push({ id: "image-1", name: "Photo", type: "RECTANGLE", fills: [{ type: "IMAGE" }], absoluteBoundingBox: { x: 110, y: 210, width: 100, height: 100 } });
    const value = svg.replace('<g data-node-id="1:2">', '<defs><linearGradient id="paint"><stop offset="0" stop-color="#ffffff"/></linearGradient><clipPath id="crop"><rect width="100" height="100"/></clipPath></defs><g data-node-id="image-1" transform="translate(10 10)" opacity="0.7" clip-path="url(#crop)"><image width="100" height="100" href="data:image/png;base64,aGVsbG8="/></g><g data-node-id="1:2">');
    const s = reconstructLayers(value, frame);
    expect(s.layers.find((l) => l.nodeId === "image-1")?.kind).toBe("image");
    expect(JSON.stringify(s.root)).toContain("url(#crop)");
    expect(JSON.stringify(s.root)).toContain("translate(10 10)");
    expect(JSON.stringify(s.root)).not.toContain("Photograph metadata");
  });
  it("rejects dangling, nested and duplicate animated layer references", () => {
    const s = scene();
    expect(() => LayerScene.parse({ ...s, layers: [...s.layers, s.layers[0]] })).toThrow();
    expect(() => LayerScene.parse({ ...s, layers: [{ ...s.layers[0], nodeId: "unknown" }] })).toThrow();
    expect(() => LayerScene.parse({ ...s, layers: [...s.layers, { ...s.layers[0], nodeId: "4:1" }] })).toThrow();
  });
  it("finishes every stagger within the entrance and is deterministic when seeking", () => {
    const image = { ...scene().layers[0]!, kind: "image" as const };
    for (const count of [1, 8, 120]) {
      for (let i = 0; i < count; i++) {
        expect(layerPose(image, i, 4, count, 4)).toEqual({ opacity: 1, translateY: 0, reveal: 1 });
        expect(layerPose(image, i, -1, count, 4)).toEqual({ opacity: 0, translateY: Math.min(28, image.height * 0.35), reveal: 0 });
      }
    }
    expect(layerPose(image, 0, 0.3, 5, 4).opacity).toBeGreaterThan(layerPose(image, 4, 0.3, 5, 4).opacity);
    const before = layerPose(image, 2, 0.7, 5, 4);
    layerPose(image, 2, 4, 5, 4);
    expect(layerPose(image, 2, 0.7, 5, 4)).toEqual(before);
  });
  it("adds the entrance only to reconstructed screens and preserves screenshot fallback", () => {
    const input = { reference: parseFigmaUrl(url), nodesResponse: nodes(), captureDataUrl, brand, brief };
    const plan = buildDesignReveal(figmaToProduct({ ...input, svg }));
    expect(plan.shots[1]!.primitives.some((p) => p.primitiveId === "presentation/layer-entrance")).toBe(true);
    const fallback = buildDesignReveal(figmaToProduct(input));
    expect(fallback.shots[1]!.primitives.some((p) => p.primitiveId === "presentation/layer-entrance")).toBe(false);
    expect(() => validateShotPlan({ ...plan, screens: fallback.screens })).toThrow("reconstructed screen");
    const bad = structuredClone(plan); bad.screens[0]!.layerScene!.width = 500;
    expect(() => validateShotPlan(bad)).toThrow("dimensions must match");
  });
  it("pins both exports to one version, requests node IDs, embeds assets, and never sends credentials to asset hosts", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(nodes()))
      .mockResolvedValueOnce(Response.json({ images: { "1:2": "https://assets.figma.test/frame.png" } }))
      .mockResolvedValueOnce(new Response(read("design.capture.png")))
      .mockResolvedValueOnce(Response.json({ images: { "1:2": "https://assets.figma.test/frame.svg" } }))
      .mockResolvedValueOnce(new Response(svg));
    const snapshot = vi.fn();
    const ir = await importFigma({ url, token: "test-secret", brand, brief, layers: true, fetch: request, onSnapshot: snapshot });
    expect(request).toHaveBeenCalledTimes(5);
    expect(String(request.mock.calls[3]![0])).toContain("format=svg&svg_outline_text=true&svg_include_node_id=true");
    expect(String(request.mock.calls[3]![0])).toContain("version=fixture-v1");
    expect(request.mock.calls[4]![1]?.headers).toBeUndefined();
    expect(snapshot).toHaveBeenCalledOnce();
    expect(ir.screens[0]!.layerScene!.layers.length).toBeGreaterThan(1);
    expect(JSON.stringify(ir)).not.toContain("test-secret");
    expect(JSON.stringify(ir)).not.toContain("assets.figma.test");
  });
});
