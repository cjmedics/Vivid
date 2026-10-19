import { z } from "zod";
import { Brand } from "./ir.js";

/** Explicit brand overrides: never infer an official brand kit from a screenshot. */
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
export const BrandKit = Brand.extend({
  primary: Hex,
  background: Hex,
  foreground: Hex,
  accent: Hex,
  fontFamily: z.string().trim().min(1),
});
export type BrandKit = z.infer<typeof BrandKit>;

/** Slot limits keep the first template readable without silently rewriting user copy. */
export const VideoBrief = z.object({
  productName: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(80),
  headline: z.string().trim().min(1).max(72),
  subtext: z.string().trim().min(1).max(120),
  cta: z.string().trim().min(1).max(36),
});
export type VideoBrief = z.infer<typeof VideoBrief>;

/** Default numeric timing contract. Reference-video extraction can populate this later. */
export const PacingProfile = z.object({
  source: z.enum(["default", "reference"]).default("default"),
  introSec: z.number().min(2).max(6).default(3),
  overviewSec: z.number().min(2).max(6).default(4),
  focusSec: z.number().min(2).max(6).default(3),
  outroSec: z.number().min(2).max(6).default(3),
  transitionSec: z.number().min(0.3).max(1).default(0.5),
});
export type PacingProfile = z.infer<typeof PacingProfile>;
