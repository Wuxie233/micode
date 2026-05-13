# Validation

## Rules

- **Valibot** is the only validation library. Never use Zod, Yup, or hand-rolled schema maps.
- **`v.safeParse`** for tolerant inputs (user-provided configs, external JSON, tool args that may be partial). Returns `{ success, output, issues }`.
- **`v.parse`** for strict internal boundaries where failure should propagate as an error (e.g., DB schema enforcement).
- **Schemas live near the boundary** they guard — config schemas in `src/config-schemas.ts`, lifecycle schemas in `src/lifecycle/schemas.ts`, tool args inline via `tool.schema.*`.
- **`v.InferOutput<typeof Schema>`** to derive the TypeScript type — single source for shape and type.
- **Sanitize user configs with allow-lists** — only pick known safe properties; discard unknown keys (never `passthrough()` when security matters).
- **Validate external CLIs' JSON output** with `v.safeParse` before accessing fields.
- **Secret detection** runs before accepting any string into Project Memory (`detectSecret` from `@/utils/secret-detect`).

## Examples

### safeParse for user config (tolerant)

```typescript
// src/config-schemas.ts
import * as v from "valibot";

const AgentOverrideSchema = v.object({
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  thinking: v.optional(ThinkingSchema),
});

// Allow-list: only pick declared safe properties
const SAFE_AGENT_PROPERTIES = ["model", "temperature", "maxTokens", "thinking"] as const;

export function sanitizeAgentOverride(raw: unknown): v.InferOutput<typeof AgentOverrideSchema> | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const prop of SAFE_AGENT_PROPERTIES) {
    if (prop in record) picked[prop] = record[prop];
  }
  const result = v.safeParse(AgentOverrideSchema, picked);
  if (!result.success) return null;
  return result.output;
}
```

### strictObject for lifecycle inputs (strict failure)

```typescript
// src/lifecycle/schemas.ts
export const StartRequestInputSchema = v.strictObject({
  summary: v.string(),
  goals: v.array(v.string()),
  constraints: v.array(v.string()),
});

export function parseStartRequestInput(raw: unknown) {
  const parsed = v.safeParse(StartRequestInputSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, input: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
```

### Tool args validated inline via tool.schema

```typescript
// src/tools/batch-read.ts
args: {
  paths: tool.schema
    .array(tool.schema.string())
    .describe("Array of file paths to read"),
  maxLines: tool.schema.number().optional().describe("Limit each file to N lines"),
},
execute: async (args) => {
  const { paths, maxLines } = args; // already validated by the tool framework
  if (!paths || paths.length === 0) return "## batch_read Failed\n\nNo paths specified";
  ...
}
```

## Anti-patterns

### Using `any` or `as unknown as T` to bypass validation

```typescript
// BAD: skips validation entirely
const config = JSON.parse(content) as MicodeConfig;

// GOOD: parse → safeParse → typed output
const raw = JSON.parse(content);
const result = v.safeParse(RawMicodeConfigSchema, raw);
if (!result.success) { /* handle */ }
const config = result.output;
```

### Schema and TypeScript type defined separately

```typescript
// BAD: two sources of truth that can drift
interface AgentOverride { model?: string; temperature?: number; }
const AgentOverrideSchema = v.object({ model: v.optional(v.string()), temperature: v.optional(v.number()) });

// GOOD: derive the type from the schema
const AgentOverrideSchema = v.object({ model: v.optional(v.string()), temperature: v.optional(v.number()) });
type AgentOverride = v.InferOutput<typeof AgentOverrideSchema>;
```
