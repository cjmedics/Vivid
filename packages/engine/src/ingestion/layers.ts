import { DOMParser, type Element } from "@xmldom/xmldom";
import { LayerScene, SvgTag, safeSvgAttribute, type DesignLayer, type VectorNode } from "@vivid/core";
import type { FigmaNode } from "./figma.js";

/** Preserve SVG geometry, ordering, local references, masks and outlined text. */
export function reconstructLayers(svg: string, frame: FigmaNode): LayerScene {
  if (Buffer.byteLength(svg) > 20 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(svg)) throw new Error("Unsupported or oversized Figma SVG export");
  const doc = new DOMParser({ onError: () => { throw new Error("Invalid Figma SVG export"); } }).parseFromString(svg, "image/svg+xml");
  const element = doc.documentElement;
  if (!element || element.localName !== "svg") throw new Error("Expected a Figma SVG frame export");
  const bounds = frame.absoluteBoundingBox!;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || Math.abs(viewBox[2]! - bounds.width) > 1 || Math.abs(viewBox[3]! - bounds.height) > 1) throw new Error("SVG dimensions do not match the selected Figma frame");
  const source = new Map<string, FigmaNode>();
  function index(node: FigmaNode): void {
    if (node.visible === false || node.opacity === 0) return;
    source.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  }
  index(frame);
  const layers: DesignLayer[] = [];
  const selected = new Set<string>();
  let count = 0;
  function convert(el: Element, depth = 0, blocked = false): VectorNode {
    if (++count > 50000 || depth > 100) throw new Error("Figma SVG is too complex for layer reconstruction");
    const tag = SvgTag.safeParse(el.localName);
    if (!tag.success || el.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("Unsupported element in Figma SVG export");
    const attrs: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes.item(i)!;
      if (!safeSvgAttribute(a.name, a.value)) throw new Error("Unsupported or external attribute in Figma SVG export");
      attrs[a.name] = a.value;
    }
    const id = attrs["data-node-id"];
    const node = id ? source.get(id) : undefined;
    const b = node?.absoluteBoundingBox;
    const definition = blocked || ["defs", "clipPath", "mask", "filter", "pattern", "symbol"].includes(tag.data);
    let chosen = false;
    if (!definition && node && b && id !== frame.id && b.width > 0 && b.height > 0 &&
      b.x < bounds.x + bounds.width && b.y < bounds.y + bounds.height && b.x + b.width > bounds.x && b.y + b.height > bounds.y && !node.isMask) {
      const image = node.fills?.some((f) => f.type === "IMAGE" && f.visible !== false && f.opacity !== 0);
      const component = ["INSTANCE", "COMPONENT"].includes(node.type) || /\b(button|cta|card|navigation|nav|input)\b/i.test(node.name);
      const kind = node.type === "TEXT" ? "text" : image ? "image" : component ? "component" : undefined;
      if (kind && (selected.has(id!) || layers.length < 120)) {
        chosen = true;
        if (!selected.has(id!)) {
          selected.add(id!);
          layers.push({ nodeId: id!, kind, x: b.x - bounds.x + viewBox![0]!, y: b.y - bounds.y + viewBox![1]!, width: b.width, height: b.height });
        }
      }
    }
    const children: VectorNode["children"] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes.item(i)!;
      if (child.nodeType === 1) children.push(convert(child as Element, depth + 1, definition || chosen));
      else if (child.nodeType === 3 && child.nodeValue?.trim()) children.push(child.nodeValue);
    }
    return { tag: tag.data, attrs, children };
  }
  const root = convert(element);
  if (!layers.length) throw new Error("SVG export has no independently addressable Figma content layers");
  return LayerScene.parse({ version: "figma-svg-v1", width: bounds.width, height: bounds.height, root, layers });
}

export async function downloadSvg(url: string, request: typeof fetch): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Frame exports must use HTTPS");
  const response = await request(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not download exported SVG frame");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Frame SVG exceeds 20 MiB; select a smaller frame"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
