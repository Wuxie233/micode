// src/tools/spawn-agent-args.ts
import * as v from "valibot";

export const AgentTaskSchema = v.object({
  agent: v.string(),
  prompt: v.string(),
  description: v.string(),
});

export type AgentTask = v.InferOutput<typeof AgentTaskSchema>;

export type NormalizeSpawnAgentResult =
  | { readonly ok: true; readonly tasks: readonly AgentTask[] }
  | { readonly ok: false; readonly message: string };

export const NO_AGENTS_MESSAGE = "No agents specified.";
export const INVALID_ARGS_MESSAGE =
  "Invalid spawn_agent arguments: each task must provide string agent, prompt, and description fields.";

const AGENTS_KEY = "agents";

const failure = (message: string): NormalizeSpawnAgentResult => ({
  ok: false,
  message,
});

const success = (tasks: readonly AgentTask[]): NormalizeSpawnAgentResult => ({
  ok: true,
  tasks,
});

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSingleTask = (candidate: unknown): AgentTask | null => {
  const parsed = v.safeParse(AgentTaskSchema, candidate);
  return parsed.success ? parsed.output : null;
};

const parseTaskArray = (candidates: readonly unknown[]): readonly AgentTask[] | null => {
  const tasks: AgentTask[] = [];
  for (const candidate of candidates) {
    const task = parseSingleTask(candidate);
    if (task === null) {
      return null;
    }
    tasks.push(task);
  }
  return tasks;
};

const normalizeArrayInput = (candidates: readonly unknown[]): NormalizeSpawnAgentResult => {
  if (candidates.length === 0) {
    return failure(NO_AGENTS_MESSAGE);
  }
  const tasks = parseTaskArray(candidates);
  return tasks === null ? failure(INVALID_ARGS_MESSAGE) : success(tasks);
};

const normalizeAgentsKey = (value: unknown): NormalizeSpawnAgentResult => {
  if (Array.isArray(value)) {
    return normalizeArrayInput(value);
  }
  const single = parseSingleTask(value);
  return single === null ? failure(INVALID_ARGS_MESSAGE) : success([single]);
};

export function normalizeSpawnAgentArgs(input: unknown): NormalizeSpawnAgentResult {
  if (Array.isArray(input)) {
    return normalizeArrayInput(input);
  }
  if (!isPlainRecord(input)) {
    return failure(INVALID_ARGS_MESSAGE);
  }
  if (Object.hasOwn(input, AGENTS_KEY)) {
    return normalizeAgentsKey(input[AGENTS_KEY]);
  }
  const single = parseSingleTask(input);
  return single === null ? failure(INVALID_ARGS_MESSAGE) : success([single]);
}
