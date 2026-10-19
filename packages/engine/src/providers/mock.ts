import { attemptCost } from "./catalog.js";
import { ProviderUnavailableError, type GenerationJobInput, type JobStatus, type ProviderId, type VideoProvider } from "./types.js";

/** Deterministic PRNG so demo runs and tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockProviderOptions {
  /** Probability a job fails at the provider (not a quality rejection). */
  failureRate?: number;
  /** Simulate an outage: every submit throws ProviderUnavailableError. */
  unavailable?: boolean;
  seed?: number;
}

/** Stands in for any real provider; bills exactly the catalog price. */
export class MockProvider implements VideoProvider {
  private jobs = new Map<string, JobStatus>();
  private counter = 0;
  private rand: () => number;

  constructor(
    readonly id: ProviderId,
    private opts: MockProviderOptions = {},
  ) {
    this.rand = seededRandom(opts.seed ?? 1);
  }

  async submit(input: GenerationJobInput): Promise<{ jobId: string }> {
    if (this.opts.unavailable) throw new ProviderUnavailableError(this.id, `${this.id} is unavailable (mock outage)`);
    const jobId = `${this.id}-job-${++this.counter}`;
    const failed = this.rand() < (this.opts.failureRate ?? 0);
    this.jobs.set(
      jobId,
      failed
        ? { state: "failed", error: "mock provider failure" }
        : {
            state: "completed",
            outputUrl: `mock://${this.id}/${input.model.modelId}/${jobId}.mp4`,
            generatedSec: Math.ceil(input.durationSec),
            reportedCost: attemptCost(input.model, input.resolution, input.durationSec, input.audio),
          },
    );
    return { jobId };
  }

  async poll(jobId: string): Promise<JobStatus> {
    return this.jobs.get(jobId) ?? { state: "failed", error: `unknown job ${jobId}` };
  }
}
