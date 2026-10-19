import type { Shot } from "@vivid/core";
import { seededRandom } from "./providers/mock.js";

export interface GeneratedOutput {
  url: string;
  generatedSec: number;
  modelKey: string;
}

export interface ValidationResult {
  pass: boolean;
  reason?: string;
}

/**
 * Shot validation gate (cost doc §1). Real checks — temporal stability, prompt adherence,
 * brand/reference fidelity — plug in behind this interface.
 */
export interface ShotValidator {
  validate(shot: Shot, output: GeneratedOutput): Promise<ValidationResult>;
}

/** Structural check that applies to every provider: did we get enough footage? */
export class DurationValidator implements ShotValidator {
  async validate(shot: Shot, output: GeneratedOutput): Promise<ValidationResult> {
    const needed = shot.generation?.durationSec ?? 0;
    return output.generatedSec + 0.25 >= needed
      ? { pass: true }
      : { pass: false, reason: `got ${output.generatedSec}s, needed ${needed}s` };
  }
}

/** Runs validators in order; first failure wins. */
export class ValidatorChain implements ShotValidator {
  constructor(private validators: ShotValidator[]) {}
  async validate(shot: Shot, output: GeneratedOutput): Promise<ValidationResult> {
    for (const v of this.validators) {
      const r = await v.validate(shot, output);
      if (!r.pass) return r;
    }
    return { pass: true };
  }
}

/** Demo/test stand-in for quality scoring: rejects outputs at a seeded per-model rate. */
export class SeededQualityValidator implements ShotValidator {
  private rand: () => number;
  constructor(
    private rejectRate: (modelKey: string) => number,
    seed = 7,
  ) {
    this.rand = seededRandom(seed);
  }
  async validate(_shot: Shot, output: GeneratedOutput): Promise<ValidationResult> {
    return this.rand() < this.rejectRate(output.modelKey) ? { pass: false, reason: "quality score below threshold (simulated)" } : { pass: true };
  }
}
