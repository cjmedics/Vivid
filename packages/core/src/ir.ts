import { z } from "zod";

/**
 * Product IR: what the Context Engine knows about the customer's product.
 * Produced by ingestion (URL + browser capture first, Figma later), consumed by presets/planner.
 */

export const RegionKind = z.enum([
  "nav",
  "sidebar",
  "hero",
  "metric",
  "chart",
  "table",
  "button",
  "input",
  "card",
  "text",
  "image",
]);
export type RegionKind = z.infer<typeof RegionKind>;

/** Bounding box in screen-relative units (0..1), so it survives any capture resolution. */
export const BBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type BBox = z.infer<typeof BBox>;

export const Region = z.object({
  id: z.string(),
  kind: RegionKind,
  label: z.string(),
  bbox: BBox,
  /** 0..1 — how visually/semantically important the element is. */
  focalScore: z.number().min(0).max(1),
  /** Displayed value for metrics/inputs, e.g. "$48,210". */
  value: z.string().optional(),
  /** Value after the demonstrated interaction, for state-change shots. */
  valueAfter: z.string().optional(),
});
export type Region = z.infer<typeof Region>;

export const Screen = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  /** R2 key or URL of a captured screenshot. Absent → renderer draws regions synthetically. */
  captureUrl: z.string().optional(),
  regions: z.array(Region),
});
export type Screen = z.infer<typeof Screen>;

export const Brand = z.object({
  primary: z.string(),
  background: z.string(),
  foreground: z.string(),
  accent: z.string(),
  fontFamily: z.string(),
  logoUrl: z.string().optional(),
});
export type Brand = z.infer<typeof Brand>;

export const ProductIR = z.object({
  product: z.object({
    name: z.string(),
    url: z.string().optional(),
    description: z.string(),
    category: z.string(),
  }),
  brand: Brand,
  screens: z.array(Screen).min(1),
  copy: z.object({
    headline: z.string(),
    subtext: z.string(),
    cta: z.string(),
  }),
});
export type ProductIR = z.infer<typeof ProductIR>;
