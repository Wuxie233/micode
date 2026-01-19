# Testing

## Rules
- Use bun:test for unit and integration tests.
- Keep tests alongside feature areas under tests/.
- Favor descriptive test names for workflows.

## Examples

### bun:test Setup
```ts
import { describe, test, expect } from "bun:test";
```

### Workflow Test
```ts
describe("milestone ingest", () => {
  test("persists milestone artifacts", async () => {
    expect(true).toBe(true);
  });
});
```

### Tool Test
```ts
describe("pty tools", () => {
  test("spawns session", () => {
    expect(true).toBe(true);
  });
});
```

## Anti-patterns

### Non-bun Test Runners
```ts
// BAD: jest is not used in this repo
import { describe } from "jest";
```

### Single File Tests
```ts
// BAD: tests mixed with runtime modules
export function run() {}
```
