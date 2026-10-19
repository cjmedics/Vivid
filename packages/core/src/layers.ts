import { z } from "zod";

/** A portable SVG scene, not executable markup. Typography is outlined by Figma. */
export const SvgTag = z.enum(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline", "use", "symbol", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "image", "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feFlood", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset", "feFuncR", "feFuncG", "feFuncB", "feFuncA", "feDropShadow", "text", "tspan"]);
const attributes = new Set("id data-node-id xmlns xmlns:xlink version width height viewBox preserveAspectRatio x y x1 x2 y1 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-dasharray stroke-dashoffset opacity clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits filter filterUnits primitiveUnits color-interpolation-filters color-interpolation gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity patternUnits patternContentUnits patternTransform href xlink:href in in2 result mode type values operator k1 k2 k3 k4 stdDeviation dx dy flood-color flood-opacity color-interpolation-filters font-family font-size font-weight font-style letter-spacing text-anchor dominant-baseline textLength lengthAdjust vector-effect paint-order visibility display isolation style".split(" "));
export function safeSvgAttribute(name: string, value: string): boolean {
  if (!attributes.has(name)) return false;
  if (value.includes("\\")) return false;
  if (name === "href" || name === "xlink:href") return /^#[\w:.-]+$/.test(value) || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value);
  if (name === "xmlns") return value === "http://www.w3.org/2000/svg";
  if (name === "xmlns:xlink") return value === "http://www.w3.org/1999/xlink";
  if (name === "style") return /^(?:\s*(?:mix-blend-mode|isolation)\s*:\s*[a-z-]+\s*;?\s*)+$/.test(value);
  if (/url\s*\(/i.test(value)) return !/url\s*\(/i.test(value.replace(/url\(#[\w:.-]+\)/g, "")) && !/[<>]|javascript:|@import/i.test(value);
  return !/[<>]|javascript:|@import|expression\s*\(/i.test(value);
}
export interface VectorNode { tag: z.infer<typeof SvgTag>; attrs: Record<string, string>; children: Array<VectorNode | string> }
export const VectorNode: z.ZodType<VectorNode> = z.lazy(() => z.object({
  tag: SvgTag,
  attrs: z.record(z.string(), z.string()).refine((a) => Object.entries(a).every(([k, v]) => safeSvgAttribute(k, v)), "Unsupported or external SVG attribute"),
  children: z.array(z.union([VectorNode, z.string()])),
}));
export const DesignLayer = z.object({
  nodeId: z.string().min(1), kind: z.enum(["text", "image", "component", "decoration"]),
  x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive(),
});
export type DesignLayer = z.infer<typeof DesignLayer>;
export const LayerScene = z.object({
  version: z.literal("figma-svg-v1"), width: z.number().positive(), height: z.number().positive(),
  root: VectorNode, layers: z.array(DesignLayer).min(1).max(120),
}).superRefine((scene, ctx) => {
  if (scene.root.tag !== "svg") ctx.addIssue({ code: "custom", message: "Layer scene needs an SVG root" });
  const ids = new Set(scene.layers.map((l) => l.nodeId));
  if (ids.size !== scene.layers.length) ctx.addIssue({ code: "custom", message: "Duplicate animated layer IDs" });
  const found = new Set<string>();
  const walk = (node: VectorNode, selectedAncestor: boolean, definition: boolean, depth: number) => {
    if (depth > 100) { ctx.addIssue({ code: "custom", message: "Layer scene too deep" }); return; }
    const selected = ids.has(node.attrs["data-node-id"] ?? "");
    const inDefinition = definition || ["defs", "clipPath", "mask", "filter", "pattern", "symbol"].includes(node.tag);
    if (selected) {
      found.add(node.attrs["data-node-id"]!);
      if (selectedAncestor || inDefinition || node === scene.root) ctx.addIssue({ code: "custom", message: "Animated layers must be disjoint content nodes" });
    }
    for (const child of node.children) if (typeof child !== "string") walk(child, selectedAncestor || selected, inDefinition, depth + 1);
  };
  walk(scene.root, false, false, 0);
  if ([...ids].some((id) => !found.has(id))) ctx.addIssue({ code: "custom", message: "Animated layer missing from SVG scene" });
});
export type LayerScene = z.infer<typeof LayerScene>;

/** Frame-addressed motion: deterministic on seek and independent of render order. */
export function layerPose(layer: DesignLayer, index: number, seconds: number, count: number, durationSec: number) {
  const stagger = count > 1 ? Math.min(0.12, Math.max(0, durationSec - 0.85) / (count - 1)) : 0;
  const start = 0.08 + index * stagger;
  const k = Math.min(1, Math.max(0, (seconds - start) / 0.65));
  const eased = 1 - (1 - k) ** 3;
  return { opacity: k, translateY: (1 - eased) * Math.min(28, layer.height * 0.35), reveal: layer.kind === "image" ? eased : 1 };
}
