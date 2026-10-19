import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { validateShotPlan } from "@vivid/core";
import { AnthropicPlanner, OpenAIPlanner, PlanningError, figmaToProduct, parseFigmaUrl, planDesign, planningTask, type PlanningProvider } from "../src/index.js";

const json = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const png = readFileSync(new URL("../../../fixtures/design.capture.png", import.meta.url));
const ir = () => figmaToProduct({
  reference: parseFigmaUrl("https://www.figma.com/design/VividFixture/Launchboard?node-id=1-2"),
  nodesResponse: json("design.nodes.json"), captureDataUrl: `data:image/png;base64,${png.toString("base64")}`,
  brand: json("design.brand.json"), brief: json("design.brief.json"),
});
const replay = () => json("planner.suggestions.json");
const usage = { inputTokens: 400, outputTokens: 200 };
const fake = (value: unknown): PlanningProvider & { generate: ReturnType<typeof vi.fn> } => ({
  id: "openai", model: "test-model", generate: vi.fn().mockResolvedValue({ value, usage, responseId: "test-response" }),
});

describe("bounded choreography and copy", () => {
  it("keeps the existing deterministic route as the default", async () => {
    const result = await planDesign(ir(), { id: "rules" });
    expect(result.audit).toMatchObject({ mode: "rules", spendStatus: "no-live-calls", choreography: { requests: 0, source: "rules" } });
    expect(result.plan.shots).toHaveLength(6);
  });
  it("compiles valid model selections while preserving captured pixels, provenance and brand", async () => {
    const input = ir(); const suggestions = replay();
    const provider = fake(suggestions.choreography);
    const result = await planDesign(input, { choreography: provider });
    expect(result.plan.shots[2]!.primitives[1]!.targetRegionId).toBe("3:3");
    expect(result.plan.shots[2]!.primitives[0]!.primitiveId).toBe("transitions/slide");
    expect(result.plan.brand).toEqual(input.brand);
    expect(result.plan.screens).toEqual(input.screens);
    expect(result.plan.source).toEqual(input.source);
    expect(result.plan.shots.every((s) => !s.generation && s.mode === "deterministic")).toBe(true);
    expect(() => validateShotPlan(result.plan)).not.toThrow();
    expect(result.audit.choreography).toMatchObject({ source: "model", requests: 1, usage });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls[0]![0].input).not.toContain("data:image");
    expect(provider.generate.mock.calls[0]![0].input).not.toContain("figma.com");
  });
  it.each(["unknown-screen", "unknown-region", "duplicates", "timing", "extra-brand", "invented-motion"])("falls back from %s without retrying a paid request", async (problem) => {
    const choice = replay().choreography;
    if (problem === "unknown-screen") choice.screenId = "hallucinated";
    if (problem === "unknown-region") choice.focusRegionIds = ["hallucinated"];
    if (problem === "duplicates") choice.focusRegionIds = ["3:1", "3:1"];
    if (problem === "timing") choice.pacing.focusSec = 100;
    if (problem === "extra-brand") choice.brand = { primary: "red" };
    if (problem === "invented-motion") choice.transition = "transitions/explode";
    const provider = fake(choice);
    const result = await planDesign(ir(), { choreography: provider });
    expect(result.audit.choreography).toMatchObject({ source: "fallback", error: "invalid-output", usage, requests: 1 });
    expect(result.plan.shots[2]!.primitives[1]!.targetRegionId).toBe("3:1");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it("retains supplied copy until a suggestion is explicitly accepted", async () => {
    const input = ir(); const suggestions = replay();
    const result = await planDesign(input, { copy: fake(suggestions.copy) });
    expect(result.plan.copy).toEqual(input.copy);
    expect(result.copySuggestion).toEqual(suggestions.copy);
    expect(result.audit).toMatchObject({ copyReviewRequired: true, copyAccepted: false });
    const reviewed = await planDesign(input, { replay: { choreography: suggestions.choreography, copy: suggestions.copy }, acceptCopy: true });
    expect(reviewed.plan.copy.headline).toBe(suggestions.copy.headline);
    expect(reviewed.audit).toMatchObject({ mode: "replay", copyAccepted: true, spendStatus: "no-live-calls" });
    expect(input.copy).toEqual(result.audit.originalCopy);
  });
  it.each(["number", "evidence", "length"])("rejects invalid %s in copy while retaining valid choreography", async (problem) => {
    const suggestions = replay();
    if (problem === "number") suggestions.copy.headline = "Ship 100% faster";
    if (problem === "evidence") suggestions.copy.evidenceIds = ["invented-source"];
    if (problem === "length") suggestions.copy.headline = "a".repeat(73);
    const result = await planDesign(ir(), { replay: suggestions, acceptCopy: true });
    expect(result.audit.choreography.source).toBe("replay");
    expect(result.audit.copy.source).toBe("fallback");
    expect(result.audit.copyAccepted).toBe(false);
    expect(result.plan.copy).toEqual(ir().copy);
  });
  it("records a refusal and does not call a second model role", async () => {
    const choreography = fake(null); choreography.generate.mockRejectedValue(new PlanningError("refusal", usage));
    const copy = fake(replay().copy);
    const result = await planDesign(ir(), { choreography, copy });
    expect(copy.generate).not.toHaveBeenCalled();
    expect(result.audit.copy.source).toBe("skipped");
    expect(result.audit.choreography.usage).toEqual(usage);
  });
  it("skips another request to an unavailable provider and requires replay before accepting copy", async () => {
    const choreography = fake(null); choreography.generate.mockRejectedValue(new PlanningError("http", undefined, 429));
    const copy = fake(replay().copy);
    const result = await planDesign(ir(), { choreography, copy });
    expect(copy.generate).not.toHaveBeenCalled();
    expect(result.audit.copy).toMatchObject({ source: "skipped", requests: 0, error: "provider-unavailable" });
    await expect(planDesign(ir(), { copy, acceptCopy: true })).rejects.toThrow("replay");
  });
  it("keeps explicit pacing authoritative and rejects invalid inputs before provider calls", async () => {
    const provider = fake(replay().choreography);
    const result = await planDesign(ir(), { choreography: provider, pacing: { focusSec: 4 } });
    expect(result.plan.shots[2]!.durationSec).toBe(4);
    await expect(planDesign(ir(), { choreography: provider, direction: "x".repeat(501) })).rejects.toThrow("500");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});

describe("structured provider adapters", () => {
  const openaiResponse = (extra = {}) => ({
    id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(replay().choreography) }] }],
    usage: { input_tokens: 400, output_tokens: 200, input_tokens_details: { cached_tokens: 100 } }, ...extra,
  });
  it("uses OpenAI Responses with strict schema, no tools, and response storage disabled", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(openaiResponse()));
    const provider = new OpenAIPlanner({ apiKey: "test-secret", model: "gpt-5.5", fetch: request });
    const task = planningTask("choreography", ir());
    const result = await provider.generate(task);
    const [url, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ model: "gpt-5.5", store: false, max_output_tokens: 2048, reasoning: { effort: "low" }, text: { format: { type: "json_schema", strict: true } } });
    expect(body.tools).toBeUndefined();
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(result.value).toEqual(replay().choreography);
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 200, cachedInputTokens: 100 });
    expect(JSON.stringify(task)).not.toContain("test-secret");
  });
  it("uses Anthropic JSON outputs and tracks cache usage", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "msg_1", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(replay().copy) }], usage: { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 80, cache_creation_input_tokens: 40 } }));
    const provider = new AnthropicPlanner({ apiKey: "test-secret", model: "claude-sonnet-5", fetch: request });
    const result = await provider.generate(planningTask("copy", ir()));
    const [url, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": "test-secret", "anthropic-version": "2023-06-01" });
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.output_config.format.schema.properties.headline.maxLength).toBeUndefined();
    expect(result.usage).toMatchObject({ cachedInputTokens: 80, cacheCreationInputTokens: 40 });
  });
  it.each([401, 429, 500])("records HTTP %s without leaking raw bodies or retrying", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("test-secret and private body", { status }));
    const provider = new OpenAIPlanner({ apiKey: "test-secret", model: "test", fetch: request });
    const result = await planDesign(ir(), { choreography: provider });
    expect(result.audit.choreography).toMatchObject({ source: "fallback", error: "http", httpStatus: status, requests: 1 });
    expect(JSON.stringify(result.audit)).not.toContain("test-secret");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["incomplete", "refusal", "malformed"])("handles OpenAI %s output without accepting partial data", async (problem) => {
    const data = problem === "incomplete" ? openaiResponse({ status: "incomplete" }) : problem === "refusal" ? openaiResponse({ output: [{ type: "message", content: [{ type: "refusal", refusal: "Not available" }] }] }) : openaiResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "{broken" }] }] });
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
    const result = await planDesign(ir(), { choreography: new OpenAIPlanner({ apiKey: "test", model: "test", fetch: request }) });
    expect(result.audit.choreography.source).toBe("fallback");
    expect(result.audit.choreography.usage?.inputTokens).toBe(400);
  });
  it("handles Anthropic truncation and network failures with audited fallback", async () => {
    const truncated = new AnthropicPlanner({ apiKey: "test", model: "test", fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ stop_reason: "max_tokens", content: [], usage: { input_tokens: 99, output_tokens: 9 } })) });
    expect((await planDesign(ir(), { choreography: truncated })).audit.choreography).toMatchObject({ error: "incomplete", usage: { inputTokens: 99 } });
    const network = new OpenAIPlanner({ apiKey: "test", model: "test", fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("private test-secret error")) });
    expect((await planDesign(ir(), { choreography: network })).audit.choreography).toMatchObject({ error: "network" });
  });
  it("rejects missing credentials and invalid output bounds before requests", () => {
    expect(() => new OpenAIPlanner({ apiKey: "", model: "gpt-5.5" })).toThrow("key");
    expect(() => new AnthropicPlanner({ apiKey: "test", model: "test", maxOutputTokens: 99999 })).toThrow();
  });
});
