import { usd } from "@vivid/core";
import { ProviderUnavailableError, type GenerationJobInput, type JobStatus, type VideoProvider } from "./types.js";

/**
 * OpenRouter async video API:
 *   POST /api/v1/videos            → 202 { id, polling_url, status: "pending" }
 *   GET  /api/v1/videos/{id}       → { status: pending|in_progress|completed|failed, unsigned_urls, urls?, usage: { cost }, error? }
 *   GET  /api/v1/videos/{id}/content?index=0  (needs Authorization; unsigned_urls are not presigned)
 */

const BASE_URL = "https://openrouter.ai/api/v1";

type FetchLike = typeof fetch;

interface OpenRouterPollResponse {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  unsigned_urls?: string[];
  urls?: string[];
  usage?: { cost?: number; is_byok?: boolean };
  error?: unknown;
}

export interface OpenRouterOptions {
  apiKey: string;
  fetch?: FetchLike;
  /** HTTPS webhook; when set, the Worker can skip polling. */
  callbackUrl?: string;
}

export class OpenRouterProvider implements VideoProvider {
  readonly id = "openrouter" as const;
  private fetchFn: FetchLike;

  constructor(private opts: OpenRouterOptions) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  async submit(input: GenerationJobInput): Promise<{ jobId: string }> {
    const res = await this.request("/videos", { method: "POST", body: JSON.stringify(toRequestBody(input, this.opts.callbackUrl)) });
    const body = (await res.json()) as { id: string };
    return { jobId: body.id };
  }

  async poll(jobId: string): Promise<JobStatus> {
    const res = await this.request(`/videos/${encodeURIComponent(jobId)}`, { method: "GET" });
    const body = (await res.json()) as OpenRouterPollResponse;
    switch (body.status) {
      case "pending":
        return { state: "pending" };
      case "in_progress":
        return { state: "running" };
      case "completed": {
        const outputUrl = body.unsigned_urls?.[0] ?? `${BASE_URL}/videos/${encodeURIComponent(jobId)}/content?index=0`;
        return {
          state: "completed",
          outputUrl,
          ...(body.usage?.cost !== undefined ? { reportedCost: usd(body.usage.cost) } : {}),
        };
      }
      default:
        return { state: "failed", error: `${body.status}: ${JSON.stringify(body.error ?? null)}` };
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      });
    } catch (err) {
      throw new ProviderUnavailableError(this.id, `network error: ${String(err)}`);
    }
    // Auth, rate limit and 5xx all mean "route elsewhere"; 4xx validation errors are our bug.
    if (res.status === 401 || res.status === 402 || res.status === 429 || res.status >= 500) {
      throw new ProviderUnavailableError(this.id, `HTTP ${res.status}: ${await res.text()}`);
    }
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
    return res;
  }
}

export function toRequestBody(input: GenerationJobInput, callbackUrl?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model.modelId,
    prompt: input.prompt,
    duration: Math.ceil(input.durationSec),
    resolution: input.resolution === "4k" ? "4K" : input.resolution,
    aspect_ratio: input.aspectRatio,
    generate_audio: input.audio,
  };
  if (input.referenceImageUrls.length > 0) {
    body.input_references = input.referenceImageUrls.map((url) => ({ type: "image_url", image_url: { url } }));
  }
  if (input.seed !== undefined) body.seed = input.seed;
  if (callbackUrl) body.callback_url = callbackUrl;
  return body;
}
