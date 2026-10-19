import { z } from "zod";
import { PlanningError, type PlanningProvider, type PlanningResponse, type PlanningTask } from "./types.js";

interface ProviderOptions { apiKey: string; model: string; fetch?: typeof fetch; maxOutputTokens?: number }
const Tokens = z.number().int().nonnegative().optional();

/** One bounded request per role. Retrying or escalating paid calls is never implicit. */
abstract class HttpPlanner {
  readonly model: string;
  protected readonly maxOutputTokens: number;
  constructor(protected readonly opts: ProviderOptions) {
    if (!opts.apiKey.trim()) throw new Error("Planner API key is missing; configure it in the environment");
    if (!opts.model.trim()) throw new Error("Planner model ID is required");
    this.model = opts.model;
    this.maxOutputTokens = z.number().int().min(256).max(8192).parse(opts.maxOutputTokens ?? 2048);
  }
  protected async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await (this.opts.fetch ?? fetch)(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: "error",
      });
    } catch { throw new PlanningError("network"); }
    if (!response.ok) throw new PlanningError("http", undefined, response.status);
    try { return await response.json(); } catch { throw new PlanningError("invalid-output"); }
  }
}

export class OpenAIPlanner extends HttpPlanner implements PlanningProvider {
  readonly id = "openai" as const;
  async generate(task: PlanningTask): Promise<PlanningResponse> {
    const raw = await this.post("https://api.openai.com/v1/responses", { Authorization: `Bearer ${this.opts.apiKey}` }, {
      model: this.model, store: false, max_output_tokens: this.maxOutputTokens,
      ...(/^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/.test(this.model) ? { reasoning: { effort: "low" } } : {}),
      instructions: task.system, input: task.input,
      text: { format: { type: "json_schema", name: `vivid_${task.role}_v1`, strict: true, schema: task.schema } },
    });
    const parsed = z.object({
      id: z.string().optional(), status: z.string(),
      output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })).optional(),
      usage: z.object({ input_tokens: Tokens, output_tokens: Tokens, input_tokens_details: z.object({ cached_tokens: Tokens }).optional() }).optional(),
    }).safeParse(raw);
    if (!parsed.success) throw new PlanningError("invalid-output");
    const body = parsed.data;
    const usage = body.usage ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens, cachedInputTokens: body.usage.input_tokens_details?.cached_tokens } : undefined;
    const content = (body.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
    if (content.some((part) => part.type === "refusal")) throw new PlanningError("refusal", usage);
    if (body.status !== "completed") throw new PlanningError("incomplete", usage);
    const text = content.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
    try { return { value: JSON.parse(text), usage, responseId: body.id }; } catch { throw new PlanningError("invalid-output", usage); }
  }
}

export class AnthropicPlanner extends HttpPlanner implements PlanningProvider {
  readonly id = "anthropic" as const;
  async generate(task: PlanningTask): Promise<PlanningResponse> {
    const raw = await this.post("https://api.anthropic.com/v1/messages", { "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" }, {
      model: this.model, max_tokens: this.maxOutputTokens,
      system: [{ type: "text", text: task.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: task.input }],
      output_config: { format: { type: "json_schema", schema: task.schema } },
    });
    const parsed = z.object({
      id: z.string().optional(), stop_reason: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
      usage: z.object({ input_tokens: Tokens, output_tokens: Tokens, cache_read_input_tokens: Tokens, cache_creation_input_tokens: Tokens }).optional(),
    }).safeParse(raw);
    if (!parsed.success) throw new PlanningError("invalid-output");
    const body = parsed.data;
    const usage = body.usage ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens, cachedInputTokens: body.usage.cache_read_input_tokens, cacheCreationInputTokens: body.usage.cache_creation_input_tokens } : undefined;
    if (body.stop_reason === "refusal") throw new PlanningError("refusal", usage);
    if (body.stop_reason !== "end_turn") throw new PlanningError("incomplete", usage);
    const text = body.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    try { return { value: JSON.parse(text), usage, responseId: body.id }; } catch { throw new PlanningError("invalid-output", usage); }
  }
}
