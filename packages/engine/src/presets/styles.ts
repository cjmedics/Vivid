/**
 * Style profiles (cost doc §11). A style composes with any preset — Feature Reveal ×
 * Minimal and Feature Reveal × Cinematic share one grammar, not two systems.
 */

export type StyleId = "minimal" | "technical" | "cinematic";

export interface StyleProfile {
  id: StyleId;
  displayName: string;
  /** Multiplier on beat durations when no target duration is given (>1 = slower). */
  pacing: number;
  typography: "typography/line-reveal" | "typography/word-reveal";
  transition: "transitions/dissolve" | "transitions/slide";
  /**
   * none      → fully deterministic
   * ambient   → hybrid intro over a generated abstract backdrop (efficient tier)
   * cinematic → generated plates on intro and outro (balanced tier minimum)
   */
  backdrop: "none" | "ambient" | "cinematic";
  /** Hard cap on generated seconds as a share of the video. */
  generativeBudget: number;
}

export const STYLES: Record<StyleId, StyleProfile> = {
  minimal: {
    id: "minimal",
    displayName: "Minimal",
    pacing: 1.1,
    typography: "typography/line-reveal",
    transition: "transitions/dissolve",
    backdrop: "ambient",
    generativeBudget: 0.25,
  },
  technical: {
    id: "technical",
    displayName: "Technical",
    pacing: 1.0,
    typography: "typography/line-reveal",
    transition: "transitions/dissolve",
    backdrop: "none",
    generativeBudget: 0,
  },
  cinematic: {
    id: "cinematic",
    displayName: "Cinematic",
    pacing: 0.9,
    typography: "typography/word-reveal",
    transition: "transitions/slide",
    backdrop: "cinematic",
    generativeBudget: 0.5,
  },
};
