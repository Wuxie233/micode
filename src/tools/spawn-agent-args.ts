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
const JSON_OBJECT_PREFIX = "{";
const JSON_ARRAY_PREFIX = "[";

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

const tryParseStringifiedJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim();
  if (!text.startsWith(JSON_OBJECT_PREFIX) && !text.startsWith(JSON_ARRAY_PREFIX)) {
    return value;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Host runtime may stringify; parse failure means downstream validation should reject it.
    return value;
  }
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
  const decoded = tryParseStringifiedJson(value);
  if (Array.isArray(decoded)) {
    return normalizeArrayInput(decoded);
  }
  const single = parseSingleTask(decoded);
  if (single !== null) {
    return success([single]);
  }
  if (isIndexedRecord(decoded)) {
    return normalizeArrayInput(normalizeSequence(decoded));
  }
  return failure(INVALID_ARGS_MESSAGE);
};

export function normalizeSpawnAgentArgs(input: unknown): NormalizeSpawnAgentResult {
  const decoded = tryParseStringifiedJson(input);
  if (Array.isArray(decoded)) {
    return normalizeArrayInput(decoded);
  }
  if (!isPlainRecord(decoded)) {
    return failure(INVALID_ARGS_MESSAGE);
  }
  if (Object.hasOwn(decoded, AGENTS_KEY)) {
    return normalizeAgentsKey(decoded[AGENTS_KEY]);
  }
  const single = parseSingleTask(decoded);
  if (single !== null) {
    return success([single]);
  }
  if (isIndexedRecord(decoded)) {
    return normalizeArrayInput(normalizeSequence(decoded));
  }
  return failure(INVALID_ARGS_MESSAGE);
}
