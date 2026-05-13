# TypeScript Type Style

## Rules

- **Strict mode** enforced (`strict: true` in tsconfig). No implicit `any`, no unchecked index access.
- **`interface`** for object contracts (shapes that may be extended or implemented) — `LedgerInfo`, `RunResult`, `ProjectMemoryStore`.
- **`type`** for unions, aliases, and mapped types — `RepoKind`, `AtlasStatus`, `SourceKind`, `v.InferOutput<typeof Schema>`.
- **`readonly`** on all data-only interfaces. Prefer `ReadonlyArray<T>` / `readonly T[]` for arrays passed across boundaries.
- **`as const`** for enum-like maps and tuple literals. Never use TypeScript `enum`.
- **`unknown`** at external boundaries (parsed JSON, error catch, tool args). Never `any`.
- **Explicit return types** on all exported functions and factory methods.
- **`v.InferOutput<typeof Schema>`** to derive types from Valibot schemas — single source of truth for shape + type.
- **No type assertions** (`as X`) except narrowing after validation. Use type predicates or Valibot `v.parse`.
- **No `!` non-null assertions** unless the value is logically guaranteed (document why with a comment).

## Examples

### Interface for store contract, readonly data

```typescript
// src/lifecycle/runner.ts
export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface LifecycleRunner {
  readonly git: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
  readonly gh: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
}
```

### Type alias from Valibot schema (single source)

```typescript
// src/config-schemas.ts
import * as v from "valibot";

const AgentOverrideSchema = v.object({
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
});

// Type is derived — no separate interface needed
type AgentOverride = v.InferOutput<typeof AgentOverrideSchema>;

// Exported parse result also typed via Valibot
export type StartRequestInputParsed = v.InferOutput<typeof StartRequestInputSchema>;
```

### `as const` enum map + derived union type

```typescript
// src/lifecycle/pre-flight.ts
export const REPO_KIND = {
  FORK: "fork",
  OWN: "own",
  UPSTREAM: "upstream",
  UNKNOWN: "unknown",
} as const;

// Derived union — stays in sync with the map automatically
export type RepoKind = (typeof REPO_KIND)[keyof typeof REPO_KIND];
```

### unknown at boundaries + type predicate narrowing

```typescript
// src/project-memory/lookup.ts
function isLookupHit(hit: LookupHit | null): hit is LookupHit {
  return hit !== null;
}

// In catch block:
} catch (error: unknown) {
  const message = extractErrorMessage(error); // never 'any'
}
```

## Anti-patterns

### TypeScript enum (use as const map instead)

```typescript
// BAD: TypeScript enum — do not use
enum RepoKind { FORK = "fork", OWN = "own" }

// GOOD: as const map
const REPO_KIND = { FORK: "fork", OWN: "own" } as const;
type RepoKind = (typeof REPO_KIND)[keyof typeof REPO_KIND];
```

### `any` at catch boundary

```typescript
// BAD: loses type safety
} catch (e: any) {
  console.error(e.message);
}

// GOOD: unknown + extractErrorMessage
} catch (e: unknown) {
  log.error("module", "failed", e);
  return extractErrorMessage(e);
}
```

### Redundant interface when schema already defines shape

```typescript
// BAD: duplicates the Valibot schema shape
interface AgentOverride {
  model?: string;
  temperature?: number;
}
const AgentOverrideSchema = v.object({ model: v.optional(v.string()), ... });

// GOOD: one definition
const AgentOverrideSchema = v.object({ model: v.optional(v.string()), ... });
type AgentOverride = v.InferOutput<typeof AgentOverrideSchema>;
```
