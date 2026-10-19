import type { AspectRatio, Capability, MicroUsd, ModelTier, Resolution } from "@vivid/core";

export type ProviderId = "openrouter" | "higgsfield" | "google" | "fal" | "replicate" | "runway";

export interface ModelPricing {
  /** Non-promotional list price per generated second at `baseResolution`. */
  perSecond: MicroUsd;
  baseResolution: Resolution;
  /** Price scales with output pixels (e.g. Seedance on OpenRouter). Flat otherwise. */
  pixelScaled: boolean;
  /** Exact published per-resolution prices, when the provider lists them. Wins over scaling. */
  byResolution?: Partial<Record<Resolution, MicroUsd>>;
  /** Extra per-second charge when audio is generated. */
  audioPerSecond?: MicroUsd;
}

export interface ModelSpec {
  /** Unique across providers: `${providerId}:${modelId}`. */
  key: string;
  providerId: ProviderId;
  /** The provider's own model slug. */
  modelId: string;
  displayName: string;
  tier: ModelTier;
  capabilities: Capability[];
  resolutions: Resolution[];
  maxDurationSec: number;
  pricing: ModelPricing;
  priceCheckedAt: string;
  /** False until slug + capabilities are confirmed against the provider's discovery API. */
  verified: boolean;
}

export interface GenerationJobInput {
  model: ModelSpec;
  prompt: string;
  durationSec: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  referenceImageUrls: string[];
  audio: boolean;
  seed?: number;
}

export type JobStatus =
  | { state: "pending" | "running" }
  | {
      state: "completed";
      outputUrl: string;
      /** Omitted when the provider doesn't report it; callers use the requested duration. */
      generatedSec?: number;
      /** Cost reported by the provider, if any. Falls back to the catalog estimate. */
      reportedCost?: MicroUsd;
    }
  | { state: "failed"; error: string };

export interface VideoProvider {
  readonly id: ProviderId;
  submit(input: GenerationJobInput): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<JobStatus>;
}

/** Thrown when a provider can't accept work (outage, auth, rate limit) — the router falls back. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly providerId: ProviderId,
    message: string,
  ) {
    super(message);
  }
}

export type ProviderRegistry = Map<ProviderId, VideoProvider>;
