// src/tools/sequence.ts
import { tool } from "@opencode-ai/plugin/tool";

type ToolSchema = Parameters<typeof tool.schema.array>[0];

const INDEX_KEY_PATTERN = /^(?:0|[1-9]\d*)$/u;

export function sequenceSchema<T extends ToolSchema>(item: T): ReturnType<typeof tool.schema.union> {
  return tool.schema.union([tool.schema.array(item), item, tool.schema.record(tool.schema.string(), item)]);
}

export function normalizeSequence<T>(input: readonly T[] | T | Record<string, T> | undefined): T[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return [...input];
  if (isIndexedObject(input)) return orderedValues(input);
  return [input as T];
}

function isIndexedObject<T>(input: readonly T[] | T | Record<string, T>): input is Record<string, T> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  return keys.length > 0 && keys.every((key) => INDEX_KEY_PATTERN.test(key));
}

function orderedValues<T>(input: Record<string, T>): T[] {
  return Object.entries(input)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => value);
}
