# Import Style

## Rules

- **Always use `@/*` path aliases** — never parent-relative `../`. Configured in `tsconfig.json` as `@/* → src/*`.
- **`node:` prefix required** for all Node built-ins: `node:path`, `node:fs/promises`, `node:crypto`, `node:os`.
- **`import type`** for type-only imports (`AgentConfig`, `ToolDefinition`, `PluginInput`, etc.). Never import runtime values from `@opencode-ai/sdk`.
- **No default exports** from source modules. Use named exports everywhere. Exception: `src/index.ts` exports a plugin default (required by OpenCode plugin API).
- **No re-exporting** of internal implementation details from an index barrel unless it is the public API surface of a subdirectory.
- **Import ordering** (enforced by ESLint/unicorn): Node built-ins → external packages → internal `@/` aliases → relative (same dir only).
- **No circular imports**. If two modules need each other, extract the shared type/constant to a third file.

## Examples

### Correct import block structure

```typescript
// src/tools/batch-read.ts
import { readFile } from "node:fs/promises";   // 1. node: built-ins
import { isAbsolute, join } from "node:path";

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"; // 2. external packages
import { tool } from "@opencode-ai/plugin/tool";

import { extractErrorMessage } from "@/utils/errors"; // 3. internal @/* aliases
```

### type-only import from SDK

```typescript
// src/agents/executor.ts
import type { AgentConfig } from "@opencode-ai/sdk"; // type-only — no runtime value

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model"; // internal, named
import { PROJECT_MEMORY_PROTOCOL } from "@/agents/project-memory-protocol";
```

### Named exports (no defaults in source modules)

```typescript
// src/utils/errors.ts
export function extractErrorMessage(e: unknown): string { ... }

// src/utils/logger.ts
export const log = { info, warn, error, debug };

// src/hooks/index.ts — barrel for public hook API
export { createLedgerLoaderHook, findCurrentLedger } from "./ledger-loader";
export { createMindmodelInjectorHook } from "./mindmodel-injector";
```

## Anti-patterns

### Parent-relative imports across directory boundaries

```typescript
// BAD: fragile on refactor
import { extractErrorMessage } from "../../utils/errors";

// GOOD
import { extractErrorMessage } from "@/utils/errors";
```

### Importing runtime values from @opencode-ai/sdk

```typescript
// BAD: sdk exports types only; runtime import crashes
import { AgentConfig } from "@opencode-ai/sdk";

// GOOD
import type { AgentConfig } from "@opencode-ai/sdk";
```

### Default export from a source module

```typescript
// BAD: breaks named-export convention
export default function extractErrorMessage(e: unknown): string { ... }

// GOOD
export function extractErrorMessage(e: unknown): string { ... }
```
