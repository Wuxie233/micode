# Backend Stack

## Rules
- Use TypeScript targeting the Bun runtime for all runtime modules.
- Build tools and hooks with @opencode-ai/plugin and @opencode-ai/plugin/tool APIs.
- Keep runtime entrypoints in src/index.ts and wire agents/tools/hooks from there.

## Examples

### Tool Definition
```ts
import { tool } from "@opencode-ai/plugin/tool";

export const pickOne = tool({
  name: "pick_one",
  execute: async () => ({ selected: "option" })
});
```

### Hook Registration
```ts
import { plugin } from "@opencode-ai/plugin";
import { mindmodelInjector } from "./hooks/mindmodel-injector";

export default plugin({
  hooks: [mindmodelInjector]
});
```

### Bun Test Usage
```ts
import { describe, test, expect } from "bun:test";

describe("tools", () => {
  test("creates question", () => {
    expect(true).toBe(true);
  });
});
```

## Anti-patterns

### Using Node-only Runtime APIs
```ts
// BAD: assumes Node-only globals
const fs = require("fs");
```

### JS Modules Without Types
```ts
// BAD: skips TypeScript types in runtime code
module.exports = function run() {};
```
