// src/tools/spawn-agent-args.ts
import * as v from "valibot";

import { normalizeSequence } from "@/tools/sequence";

export const AgentTaskSchema = v.object({
  agent: v.string(),
  prompt: v.string(),
  description: v.string(),
  model: v.optional(v.string()),
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

const INDEX_KEY_PATTERN = /^(?:0|[1-9]\d*)$/u;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIndexedRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => INDEX_KEY_PATTERN.test(key));
};

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
  if (single !== null) {
    return success([single]);
  }
  if (isIndexedRecord(value)) {
    return normalizeArrayInput(normalizeSequence(value));
  }
  return failure(INVALID_ARGS_MESSAGE);
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
  if (single !== null) {
    return success([single]);
  }
  if (isIndexedRecord(input)) {
    return normalizeArrayInput(normalizeSequence(input));
  }
  return failure(INVALID_ARGS_MESSAGE);
}
