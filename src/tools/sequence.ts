// src/tools/sequence.ts
import { tool } from "@opencode-ai/plugin/tool";

type ToolSchema = Parameters<typeof tool.schema.array>[0];

const INDEX_KEY_PATTERN = /^(?:0|[1-9]\d*)$/u;
const JSON_OBJECT_PREFIX = "{";
const JSON_ARRAY_PREFIX = "[";

export function sequenceSchema<T extends ToolSchema>(item: T): ReturnType<typeof tool.schema.union> {
  return tool.schema.union([tool.schema.array(item), item, tool.schema.record(tool.schema.string(), item)]);
}

export function normalizeSequence<T>(input: readonly T[] | T | Record<string, T> | undefined | string): T[] {
  const decoded = tryParseStringifiedJson(input);
  if (decoded === undefined) return [];
  if (Array.isArray(decoded)) return [...(decoded as readonly T[])];
  if (isIndexedObject(decoded)) return orderedValues(decoded as Record<string, T>);
  return [decoded as T];
}

// Some host runtimes serialize array/object tool arguments back to a JSON
// string before dispatch. We restore the structured value here so downstream
// schema validation sees the shape the caller intended.
function tryParseStringifiedJson(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const text = input.trim();
  if (!text.startsWith(JSON_OBJECT_PREFIX) && !text.startsWith(JSON_ARRAY_PREFIX)) {
    return input;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Malformed JSON: keep the original string so downstream wraps it as a
    // single value, matching the legacy behavior.
    return input;
  }
}

function isIndexedObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  return keys.length > 0 && keys.every((key) => INDEX_KEY_PATTERN.test(key));
}

function orderedValues<T>(input: Record<string, T>): T[] {
  return Object.entries(input)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => value);
}
