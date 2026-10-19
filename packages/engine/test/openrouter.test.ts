import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, OpenRouterProvider, ProviderUnavailableError, toRequestBody, type GenerationJobInput } from "../src/index.js";

const model = DEFAULT_CATALOG.find((m) => m.providerId === "openrouter")!;
const input: GenerationJobInput = {
  model,
  prompt: "abstract",
  durationSec: 4.4,
  resolution: "1080p",
  aspectRatio: "16:9",
  referenceImageUrls: ["https://r2.example/ref.png"],
  audio: false,
};

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("OpenRouterProvider", () => {
  it("maps a job to the documented request body", () => {
    expect(toRequestBody(input)).toEqual({
      model: model.modelId,
      prompt: "abstract",
      duration: 5,
      resolution: "1080p",
      aspect_ratio: "16:9",
      generate_audio: false,
      input_references: [{ type: "image_url", image_url: { url: "https://r2.example/ref.png" } }],
    });
  });

  it("submits, polls and reads the reported cost", async () => {
    const { fn, calls } = fakeFetch([
      { status: 202, body: { id: "job-1", polling_url: "x", status: "pending" } },
      { status: 200, body: { id: "job-1", status: "in_progress" } },
      { status: 200, body: { id: "job-1", status: "completed", unsigned_urls: ["https://openrouter.ai/out.mp4"], usage: { cost: 0.25 } } },
    ]);
    const p = new OpenRouterProvider({ apiKey: "k", fetch: fn });
    const { jobId } = await p.submit(input);
    expect(jobId).toBe("job-1");
    expect(await p.poll(jobId)).toEqual({ state: "running" });
    expect(await p.poll(jobId)).toEqual({ state: "completed", outputUrl: "https://openrouter.ai/out.mp4", reportedCost: 250_000 });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/videos");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("treats rate limits and outages as unavailable so the router falls back", async () => {
    const { fn } = fakeFetch([{ status: 429, body: { error: "slow down" } }]);
    await expect(new OpenRouterProvider({ apiKey: "k", fetch: fn }).submit(input)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
