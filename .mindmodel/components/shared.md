# Shared Components & Patterns

## Rules

- **Protocol constants** (`ATLAS_MENTAL_MODEL_PROTOCOL`, `PROJECT_MEMORY_PROTOCOL`, `KNOWLEDGE_CONTEXT_SECTION`) are single-source strings in `src/agents/*.ts`. Import and inject via template literals — never copy-paste. Drift guards in `tests/agents/` enforce byte-identity.
- **Hook factory pattern**: `createXHook(ctx: PluginInput)` returns a handler function or handler object. State closed over in the factory. No class instances.
- **Config single source**: `src/utils/config.ts` holds all named constants. Files that need a constant import from `@/utils/config` — never define duplicate magic values.
- **`extractErrorMessage`**: the shared error normalization utility used by ~58 files. Always import from `@/utils/errors`, never re-implement.
- **`log`**: the shared logger from `@/utils/logger`. Module-prefixed format `[module] message`. Used everywhere — no direct `console.*` calls in source modules.
- **LRU cache pattern**: when caching computed results in a hook (e.g., mindmodel category matches), use the `createLRUCache<V>(maxSize)` factory pattern rather than a plain `Map` to avoid unbounded growth.
- **Agent config structure**: every agent must export `AgentConfig` with `description`, `mode` (`"primary"` | `"subagent"`), `temperature`, and `prompt`. Optional: `maxTokens`, `thinking`, `tools`. Protocol constants injected at the end of the prompt string.

## Examples

### Protocol constant injection into agent prompt

```typescript
// src/agents/commander.ts — single-source injection via template literal
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";
import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";

const PROMPT = `
<identity>You are Commander...</identity>

${ATLAS_MENTAL_MODEL_PROTOCOL}

${PROJECT_MEMORY_PROTOCOL}

<effect-first-reporting>
  ${KNOWLEDGE_CONTEXT_SECTION}
</effect-first-reporting>
`;

export const commanderAgent: AgentConfig = {
  description: "Orchestrator agent for all user-facing tasks",
  mode: "primary",
  temperature: 0.2,
  prompt: PROMPT,
};
```

### Hook factory with closed-over LRU cache

```typescript
// src/hooks/mindmodel-injector.ts
function createLRUCache<V>(maxSize: number): LRUCache<V> {
  const cache = new Map<string, V>();
  return {
    get(key) {
      const value = cache.get(key);
      if (value !== undefined) { cache.delete(key); cache.set(key, value); }
      return value;
    },
    set(key, value) {
      if (cache.has(key)) cache.delete(key);
      else if (cache.size >= maxSize) cache.delete(cache.keys().next().value!);
      cache.set(key, value);
    },
    has(key) { return cache.has(key); },
  };
}

export function createMindmodelInjectorHook(ctx: PluginInput) {
  const taskCache = createLRUCache<string[]>(TASK_CACHE_MAX_ENTRIES); // closed-over state
  return async (messages: Message[]) => {
    // ... use taskCache to avoid re-matching categories for the same task
  };
}
```

### Agent config structure (full shape)

```typescript
// src/agents/executor.ts
export const executorAgent: AgentConfig = {
  description: "Executes plan with batch-first parallelism - groups independent tasks, spawns all in parallel",
  mode: "subagent",
  temperature: 0.2,
  // maxTokens and thinking are optional — only set when agent needs extended output
  prompt: `<environment>...</environment>
<purpose>...</purpose>
${ATLAS_MENTAL_MODEL_PROTOCOL}
${PROJECT_MEMORY_PROTOCOL}`,
};
```

## Anti-patterns

### Re-implementing extractErrorMessage locally

```typescript
// BAD: wheel re-invention, inconsistent behavior
function getErrorMsg(e: unknown): string {
  return e instanceof Error ? e.message : JSON.stringify(e);
}

// GOOD: use the shared utility
import { extractErrorMessage } from "@/utils/errors";
const msg = extractErrorMessage(e);
```

### Duplicating a protocol constant across agent files

```typescript
// BAD: copy-pasted ATLAS block in two agents — will drift silently
// brainstormer.ts:
const proto = `<atlas-mental-model ...>...</atlas-mental-model>`;
// executor.ts:
const proto = `<atlas-mental-model ...>...</atlas-mental-model>`; // different wording already

// GOOD: one source, imported everywhere
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
// Test in tests/agents/atlas-protocol-injection.test.ts detects drift
```

### Unbounded Map as cache in a long-running hook

```typescript
// BAD: Map grows without bound for every unique task string
const cache = new Map<string, string[]>();
// inside hook: cache.set(taskHash, matched);

// GOOD: bounded LRU cache
const cache = createLRUCache<string[]>(TASK_CACHE_MAX_ENTRIES);
```
