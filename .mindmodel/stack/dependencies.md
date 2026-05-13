# Dependencies

## Rules

- **Approved runtime deps only**: `@opencode-ai/plugin`, `@opencode-ai/sdk` (types), `valibot`, `yaml`, `jsonc-parser`, `bun-pty` (lazy-loaded).
- **Built-ins** with `node:` prefix: `node:fs/promises`, `node:path`, `node:crypto`, `node:os`. Always use the `node:` prefix.
- **Never add**: `zod` (use valibot), `axios`/`node-fetch` (use `fetch`), `lodash`/`ramda`, `moment`/`dayjs` (use `Temporal` or `Date`), `uuid` (use SHA digest).
- **`yaml`** is used only for reading/writing `.mindmodel/manifest.yaml`. Do not use it for any other config parsing.
- **`jsonc-parser`** for `opencode.json` and `micode.jsonc` — allows comments and trailing commas.
- `@opencode-ai/sdk` types (e.g., `AgentConfig`, `McpLocalConfig`) are import-type only; never import runtime values from it.
- Adding a new runtime dependency requires an architectural decision — it widens the attack surface of the published plugin.

## Examples

### Correct import of plugin tool API

```typescript
// src/tools/batch-read.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
// @opencode-ai/sdk is type-only
import type { AgentConfig } from "@opencode-ai/sdk";
```

### Valibot schema (approved validation library)

```typescript
// src/config-schemas.ts
import * as v from "valibot";

const AgentOverrideSchema = v.object({
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
});

// safeParse for tolerant input (user configs)
const result = v.safeParse(AgentOverrideSchema, raw);
if (!result.success) return null;
return result.output;
```

### jsonc-parser for config files

```typescript
// src/config-loader.ts
import { type ParseError, parse as parseJsonc } from "jsonc-parser";

function parseConfigJson(content: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`Invalid JSON/JSONC: ${errors.length} parse error(s)`);
  return parsed;
}
```

## Anti-patterns

### Using Zod instead of Valibot

```typescript
// BAD: Zod is not an approved dependency
import { z } from "zod";
const schema = z.object({ model: z.string().optional() });
```

### Missing node: prefix on built-ins

```typescript
// BAD: works but ambiguous with npm packages
import { join } from "path";
import { readFile } from "fs/promises";

// GOOD
import { join } from "node:path";
import { readFile } from "node:fs/promises";
```

### Direct console.log instead of logger

```typescript
// BAD: bypasses structured logging
console.log("hook loaded");

// GOOD
import { log } from "@/utils/logger";
log.info("my-hook", "hook loaded");
```
