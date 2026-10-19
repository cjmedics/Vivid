export type PlanningRole = "choreography" | "copy";
export type PlannerProviderId = "openai" | "anthropic";
export interface PlanningTask {
  role: PlanningRole;
  system: string;
  input: string;
  schema: Record<string, unknown>;
}
export interface PlanningUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}
export interface PlanningResponse {
  value: unknown;
  usage?: PlanningUsage;
  responseId?: string;
}
export interface PlanningProvider {
  readonly id: PlannerProviderId;
  readonly model: string;
  generate(task: PlanningTask): Promise<PlanningResponse>;
}
export class PlanningError extends Error {
  constructor(readonly code: "network" | "http" | "incomplete" | "refusal" | "invalid-output", readonly usage?: PlanningUsage, readonly httpStatus?: number) {
    // Never include raw provider bodies, credentials, or rejected model text in errors.
    super(`Planner ${code}`);
  }
}
