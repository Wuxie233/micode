# Plugin Layers

## Rules

- The plugin is structured in four layers, loaded in order by `src/index.ts`:
  1. **Utils** (`src/utils/`) — pure functions: errors, logger, config, crypto, project-id, secret-detect.
  2. **Tools** (`src/tools/`) — stateless tool factories returning `ToolDefinition`; no agent calls.
  3. **Hooks** (`src/hooks/`) — lifecycle hooks wrapping OpenCode message/response pipeline; side effects confined to their scope.
  4. **Agents** (`src/agents/`) — `AgentConfig` exports: description, mode, temperature, prompt string assembled from protocol constants.
- **Lifecycle** (`src/lifecycle/`) is a separate sub-system: issue/branch/worktree state machine, git/gh runners, merge, cleanup. Lifecycle is a **source provider only** — it never spawns atlas-compiler or writes Atlas/Project Memory.
- **No cross-layer upward imports**: utils must not import from tools/hooks/agents; tools must not import from hooks/agents; hooks must not import from agents.
- **`src/index.ts`** is the composition root. It wires utils → tools → hooks → agents → lifecycle into the `OpenCodeConfigPlugin`. Do not add business logic to index.ts.
- **Each layer is independently testable**: test utils without tools, test tools with a mock `PluginInput`, test agents by importing the exported `AgentConfig` directly.

## Examples

### Layer imports flow (top of each file)

```typescript
// src/hooks/mindmodel-injector.ts — hook imports from utils and mindmodel sub-module
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { formatExamplesForInjection, loadMindmodel } from "@/mindmodel"; // internal sub-module
import { matchCategories } from "@/tools/mindmodel-lookup";              // tool (ok: hook → tool)
import { config } from "@/utils/config";                                  // utils (ok: hook → utils)
// NOTE: hooks NEVER import from @/agents/
```

```typescript
// src/agents/executor.ts — agent imports only from @/agents/* and @/utils/*
import type { AgentConfig } from "@opencode-ai/sdk";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { PROJECT_MEMORY_PROTOCOL } from "@/agents/project-memory-protocol";
// NOTE: agents do NOT import from @/tools/ or @/hooks/
```

### src/index.ts as composition root (wiring only)

```typescript
// src/index.ts (excerpt) — wires layers together, no business logic
import { createBatchReadTool, createMindmodelLookupTool } from "@/tools/batch-read";
import { createLedgerLoaderHook, createMindmodelInjectorHook } from "@/hooks";
import { agents } from "@/agents";
import { createLifecycleStore } from "@/lifecycle";

// Compose into OpenCodeConfigPlugin — no logic here, only wiring
export default {
  agents,
  tools: [createBatchReadTool(ctx), ...createMindmodelLookupTool(ctx)],
  hooks: [createLedgerLoaderHook(ctx), createMindmodelInjectorHook(ctx)],
} satisfies Plugin;
```

## Anti-patterns

### Agent importing from a tool directly

```typescript
// BAD: agents must not import from tools
import { createBatchReadTool } from "@/tools/batch-read";
// inside an agent file — this is a layer violation

// GOOD: agents receive tools via the plugin's tool registry; they call them by name in prompts
```

### Business logic in src/index.ts

```typescript
// BAD: parsing logic in the composition root
export default function createPlugin(input: PluginInput) {
  const port = parseInt(process.env.OCTTO_PORT ?? "0"); // should be in utils/config.ts
  if (port > 65535) throw new Error("bad port");        // layer violation
  ...
}
```

### Lifecycle hooks writing Atlas vault

```typescript
// BAD: lifecycle finish must NOT auto-spawn atlas-compiler
lifecycle.onFinish(async () => {
  await spawnAgent("atlas-compiler", ...); // forbidden — lifecycle is source provider only
});
```
