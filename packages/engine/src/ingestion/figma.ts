import { z } from "zod";
import { BrandKit, ProductIR, VideoBrief, type Region, type RegionKind } from "@vivid/core";
import { downloadSvg, reconstructLayers } from "./layers.js";

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  clipsContent?: boolean;
  isMask?: boolean;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  style?: { fontFamily?: string; fontSize?: number };
  fills?: Array<{ type: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } }>;
  children?: FigmaNode[];
}

const Node: z.ZodType<FigmaNode> = z.lazy(() => z.object({
  id: z.string().min(1), name: z.string(), type: z.string(),
  visible: z.boolean().optional(), opacity: z.number().optional(), clipsContent: z.boolean().optional(), characters: z.string().optional(),
  isMask: z.boolean().optional(),
  absoluteBoundingBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  style: z.object({ fontFamily: z.string().optional(), fontSize: z.number().optional() }).optional(),
  fills: z.array(z.object({
    type: z.string(), visible: z.boolean().optional(), opacity: z.number().optional(),
    color: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
  })).optional(),
  children: z.array(Node).optional(),
}));

const NodesResponse = z.object({
  version: z.string().optional(),
  nodes: z.record(z.string(), z.object({ document: Node }).nullable()),
});

function selectedFrame(nodesResponse: unknown, nodeId: string): FigmaNode {
  const frame = NodesResponse.parse(nodesResponse).nodes[nodeId]?.document;
  if (!frame || !["FRAME", "COMPONENT", "INSTANCE"].includes(frame.type)) throw new Error("The Figma link must select a frame, component, or instance");
  const box = frame.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0 || frame.visible === false || frame.opacity === 0) throw new Error("Selected Figma frame is empty or hidden");
  return frame;
}

export interface FigmaReference { fileKey: string; nodeId: string; url: string }

export function parseFigmaUrl(value: string): FigmaReference {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error("Use an HTTPS figma.com design or file link");
  }
  const match = url.pathname.match(/^\/(?:design|file)\/([a-zA-Z0-9]+)(?:\/|$)/);
  const raw = url.searchParams.get("node-id");
  if (!match || !raw || !/^[A-Za-z0-9:;_-]+$/.test(raw)) throw new Error("Select a frame in Figma and copy its link (node-id is required)");
  const nodeId = raw.replace(/(\d+)-(?=\d+)/g, "$1:");
  const clean = new URL(`https://www.figma.com/design/${match[1]}/`);
  clean.searchParams.set("node-id", nodeId);
  return { fileKey: match[1]!, nodeId, url: clean.href };
}

/** Snapshot and live ingestion share this exact transformation. No fabricated interaction states. */
export function figmaToProduct(input: {
  reference: FigmaReference; nodesResponse: unknown; captureDataUrl: string; brand: unknown; brief: unknown; svg?: string;
}): ProductIR {
  const response = NodesResponse.parse(input.nodesResponse);
  const frame = selectedFrame(response, input.reference.nodeId);
  const box = frame.absoluteBoundingBox!;
  if (!input.captureDataUrl.startsWith("data:image/png;base64,")) throw new Error("A materialized PNG frame capture is required");
  const image = Buffer.from(input.captureDataUrl.slice("data:image/png;base64,".length), "base64");
  if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG capture");
  const captureWidth = image.readUInt32BE(16); const captureHeight = image.readUInt32BE(20);
  if (!captureWidth || !captureHeight || Math.abs(captureWidth / captureHeight - box.width / box.height) > 0.01) throw new Error("Capture aspect ratio does not match the selected Figma frame; export with use_absolute_bounds=true");
  const brief = VideoBrief.parse(input.brief);
  const brand = BrandKit.parse(input.brand);
  const regions: Region[] = [];
  function visit(node: FigmaNode, clip = box): void {
    if (node.visible === false || node.opacity === 0) return;
    const bounds = node.absoluteBoundingBox;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const left = Math.max(bounds.x, clip.x);
      const top = Math.max(bounds.y, clip.y);
      const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
      const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height);
      if (right > left && bottom > top) {
        const kind = classify(node);
        if (kind) {
          const bbox = { x: (left - box!.x) / box!.width, y: (top - box!.y) / box!.height, w: (right - left) / box!.width, h: (bottom - top) / box!.height };
          const colors = (node.fills ?? []).filter((f) => f.type === "SOLID" && f.visible !== false && f.opacity !== 0 && f.color).map((f) => {
            const c = f.color!;
            return "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
          });
          regions.push({
            id: node.id, sourceNodeId: node.id, kind, label: node.characters ?? node.name,
            bbox, focalScore: Math.min(1, (kind === "card" || kind === "chart" || kind === "hero" ? 0.6 : 0.3) + Math.sqrt(bbox.w * bbox.h) * 0.4),
            ...(node.characters !== undefined ? { value: node.characters } : {}),
            design: { fontFamily: node.style?.fontFamily, fontSize: node.style?.fontSize, fillColors: colors },
          });
          // A named semantic container is one focal region; don't duplicate it with its children.
          if (node.type !== "TEXT") return;
        }
      }
    }
    const childClip = node.clipsContent && bounds ? {
      x: Math.max(bounds.x, clip.x), y: Math.max(bounds.y, clip.y),
      width: Math.max(0, Math.min(bounds.x + bounds.width, clip.x + clip.width) - Math.max(bounds.x, clip.x)),
      height: Math.max(0, Math.min(bounds.y + bounds.height, clip.y + clip.height) - Math.max(bounds.y, clip.y)),
    } : clip;
    for (const child of node.children ?? []) visit(child, childClip);
  }
  for (const child of frame.children ?? []) visit(child);
  if (!regions.length) throw new Error("Selected frame has no visible, bounded content to highlight");
  return ProductIR.parse({
    source: { kind: "figma", ...input.reference, version: response.version },
    product: { name: brief.productName, description: brief.description, category: brief.category },
    brand,
    screens: [{ id: frame.id, name: frame.name, url: input.reference.url, captureUrl: input.captureDataUrl, width: box.width, height: box.height, regions,
      ...(input.svg ? { layerScene: reconstructLayers(input.svg, frame) } : {}),
    }],
    copy: { headline: brief.headline, subtext: brief.subtext, cta: brief.cta },
  });
}

function classify(node: FigmaNode): RegionKind | undefined {
  const n = node.name.toLowerCase();
  if (/\b(nav|navigation)\b/.test(n)) return "nav";
  if (/\b(sidebar)\b/.test(n)) return "sidebar";
  if (/\b(chart|graph)\b/.test(n)) return "chart";
  if (/\b(metric|stat|kpi)\b/.test(n)) return "metric";
  if (/\b(button|cta)\b/.test(n)) return "button";
  if (/\b(input|search)\b/.test(n)) return "input";
  if (/\b(hero)\b/.test(n)) return "hero";
  if (/\b(card|feature)\b/.test(n) || node.type === "INSTANCE") return "card";
  if (node.type === "TEXT") return "text";
  if ((node.fills ?? []).some((f) => f.type === "IMAGE" && f.visible !== false)) return "image";
  return undefined;
}

export class FigmaApiError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null, readonly reason: "invalid-token" | "expired-token" | "scope" | "file-access" | "unspecified" = "unspecified", readonly stage: "nodes" | "export" = "nodes") {
    super(status === 429 ? `Figma rate limit reached. Retry after ${retryAfter ?? "the provider reset"}.` :
      status === 401 || status === 403 ? "Figma access denied. Check FIGMA_ACCESS_TOKEN and file_content:read access to this file." :
      status === 404 ? "Figma file or frame was not found." : `Figma request failed (HTTP ${status})`);
    this.message += ` Figma diagnostic: HTTP ${status}; stage=${stage}; reason=${reason}.`;
  }
}

/** PNG bytes are embedded in the resulting plan, so expiring provider URLs cannot break a render. */
export async function importFigma(input: {
  url: string; token: string; brand: unknown; brief: unknown; fetch?: typeof fetch; layers?: boolean;
  onSnapshot?: (snapshot: { nodesResponse: unknown; captureDataUrl: string; svg?: string }) => void;
}): Promise<ProductIR> {
  const reference = parseFigmaUrl(input.url);
  if (!input.token.trim()) throw new Error("Set FIGMA_ACCESS_TOKEN before importing a live Figma frame");
  // Validate local inputs before consuming API quota.
  const brand = BrandKit.parse(input.brand);
  const brief = VideoBrief.parse(input.brief);
  const request = input.fetch ?? fetch;
  async function api(path: string): Promise<unknown> {
    const res = await request(`https://api.figma.com/v1/${path}`, {
      headers: { "X-Figma-Token": input.token }, signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!res.ok) {
      // Classify the provider's error without storing or exposing its raw response.
      let reason: FigmaApiError["reason"] = "unspecified";
      try {
        const body = await res.json() as { err?: unknown; message?: unknown };
        const detail = [body.err, body.message].filter((v): v is string => typeof v === "string").join(" ").slice(0, 4096).toLowerCase();
        if (/scope/.test(detail)) reason = "scope";
        else if (/expired/.test(detail)) reason = "expired-token";
        else if (/invalid.*token|token.*invalid/.test(detail)) reason = "invalid-token";
        else if (/permission|access denied|not authorized|forbidden/.test(detail)) reason = "file-access";
      } catch { /* Non-JSON errors retain an unspecified reason. */ }
      throw new FigmaApiError(res.status, res.headers.get("retry-after"), reason, path.startsWith("images/") ? "export" : "nodes");
    }
    return res.json();
  }
  const query = new URLSearchParams({ ids: reference.nodeId });
  const nodes = NodesResponse.parse(await api(`files/${reference.fileKey}/nodes?${query}`));
  // Validate frame existence and geometry before asking Figma for an export.
  selectedFrame(nodes, reference.nodeId);
  const exportQuery = new URLSearchParams({ ids: reference.nodeId, format: "png", scale: "2", use_absolute_bounds: "true" });
  if (nodes.version) exportQuery.set("version", nodes.version);
  const exported = z.object({ images: z.record(z.string(), z.string().nullable()) }).parse(await api(`images/${reference.fileKey}?${exportQuery}`));
  const imageUrl = exported.images[reference.nodeId];
  if (!imageUrl) throw new Error("Figma could not export the selected frame");
  const captureDataUrl = await downloadPng(imageUrl, request);
  let svg: string | undefined;
  if (input.layers) {
    const svgQuery = new URLSearchParams({ ids: reference.nodeId, format: "svg", svg_outline_text: "true", svg_include_node_id: "true", svg_include_id: "true", use_absolute_bounds: "true" });
    if (nodes.version) svgQuery.set("version", nodes.version);
    const exportedSvg = z.object({ images: z.record(z.string(), z.string().nullable()) }).parse(await api(`images/${reference.fileKey}?${svgQuery}`));
    const svgUrl = exportedSvg.images[reference.nodeId];
    if (!svgUrl) throw new Error("Figma could not export the selected frame as SVG");
    svg = await downloadSvg(svgUrl, request);
  }
  input.onSnapshot?.({ nodesResponse: nodes, captureDataUrl, svg });
  return figmaToProduct({ reference, nodesResponse: nodes, captureDataUrl, brand, brief, svg });
}

/** No API authorization is ever forwarded to the asset host. */
export async function downloadPng(url: string, request: typeof fetch = fetch): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Frame exports must use HTTPS");
  const response = await request(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not download exported frame");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Frame export exceeds 20 MiB; select a smaller frame"); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Frame export is not a PNG");
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
