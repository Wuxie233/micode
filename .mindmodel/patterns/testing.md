# Testing

## Rules

- **Test runner: Bun test** — `bun test`. No Jest, Vitest, or Mocha.
- **BDD style**: `describe` / `it` / `expect` from `bun:test`. Use `it("should ...")` for behavior descriptions.
- **Tests mirror `src/`** under `tests/`. Example: `src/agents/atlas-mental-model.ts` → `tests/agents/atlas-mental-model.test.ts`.
- **Drift guard tests** are first-class: any protocol constant that must stay byte-identical across multiple files gets a dedicated test that imports all consumers and checks `toContain` / exact match.
- **TDD default** for any exported logic with meaningful behavior risk: parse/validate/normalize, state transitions, error handling branches, cross-module contract behavior.
- **`Test: none`** for low-risk tasks: prompt-only changes, pure config, agent string edits, glue code.
- **Tests enforce contracts, not implementation**: test observable behavior (return values, formatted strings, SQL queries), not internal private helpers.
- **No mocking of `@/utils/*`** — these are pure functions; test them directly.
- **DB tests**: create an in-memory `new Database(":memory:")` and pass to the store factory — no temp files.

## Examples

### Drift guard test (byte-identity across agents)

```typescript
// tests/agents/atlas-protocol-injection.test.ts
import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";

describe("atlas-mental-model protocol drift guard", () => {
  const cases = [
    ["brainstormer", brainstormerAgent],
    ["commander", commanderAgent],
    ["executor", executorAgent],
  ] as const;

  for (const [name, agent] of cases) {
    it(`${name} injects ATLAS_MENTAL_MODEL_PROTOCOL exactly once`, () => {
      expect(agent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
      const matches = (agent.prompt ?? "").match(/<atlas-mental-model/gu) ?? [];
      expect(matches.length).toBe(1);
    });
  }
});
```

### Protocol content invariants test

```typescript
// tests/agents/atlas-mental-model.test.ts
import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL, ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";

describe("ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  it("contains all four protocol verbs", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Read">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Maintain">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Verify">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Report">');
  });

  it("exports canonical status value list", () => {
    expect(ATLAS_STATUS_VALUES).toEqual([
      "consulted", "read-only", "maintained", "verified",
      "no-change", "delta-created", "stale-detected", "conflict", "blocked", "cannot-assess",
    ]);
  });
});
```

### In-memory SQLite store test

```typescript
// tests/project-memory/store.test.ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createProjectMemoryStore } from "@/project-memory/store";

describe("ProjectMemoryStore", () => {
  it("returns null for unknown entity", async () => {
    const db = new Database(":memory:");
    const store = createProjectMemoryStore(db);
    const result = await store.loadEntity("proj_123", "ent_nonexistent");
    expect(result).toBeNull();
  });
});
```

## Anti-patterns

### Testing implementation details instead of contracts

```typescript
// BAD: tests internal helper, not observable behavior
it("hashTask produces 36-radix output", () => {
  expect(hashTask("test")).toMatch(/^[0-9a-z-]+$/);
});

// GOOD: test the observable contract
it("matchCategories returns paths that match query keywords", () => {
  const result = matchCategories("error handling", manifest);
  expect(result).toContain("patterns/error-handling.md");
});
```

### Drift guard written as a comment instead of a test

```typescript
// BAD: comment that won't catch future drift
// NOTE: keep ATLAS_MENTAL_MODEL_PROTOCOL in sync across all agents

// GOOD: enforce with an actual test in tests/agents/
it("executor injects ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  expect(executorAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
});
```
