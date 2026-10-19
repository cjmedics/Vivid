import { z } from "zod";

/** Models select this bounded vocabulary. Application code remains the only plan compiler. */
export const ChoreographyChoice = z.strictObject({
  screenId: z.string().min(1),
  focusRegionIds: z.array(z.string().min(1)).max(3),
  typography: z.enum(["typography/line-reveal", "typography/word-reveal"]),
  transition: z.enum(["transitions/dissolve", "transitions/slide"]),
  pacing: z.strictObject({
    introSec: z.number().min(2).max(6),
    overviewSec: z.number().min(2).max(6),
    focusSec: z.number().min(2).max(6),
    outroSec: z.number().min(2).max(6),
    transitionSec: z.number().min(0.3).max(1),
  }),
  note: z.string().max(400),
});
export type ChoreographyChoice = z.infer<typeof ChoreographyChoice>;

/** Suggestions remain reviewable; generation does not automatically replace supplied copy. */
export const CopySuggestion = z.strictObject({
  headline: z.string().trim().min(1).max(72),
  subtext: z.string().trim().min(1).max(120),
  cta: z.string().trim().min(1).max(36),
  evidenceIds: z.array(z.string().min(1)).min(1).max(8),
});
export type CopySuggestion = z.infer<typeof CopySuggestion>;
