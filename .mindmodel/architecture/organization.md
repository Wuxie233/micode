# Directory Organization

## Rules

- **Source layout** mirrors functional domain, not technical type:
  ```
  src/
    agents/       — AgentConfig exports; one file per agent
    atlas/        — Atlas vault read/write logic and cold-init workers
    hooks/        — Hook factories for the OpenCode message pipeline
    indexing/     — Artifact FTS indexing
    lifecycle/    — Issue/branch/worktree state machine
    mindmodel/    — .mindmodel/ manifest loading and example formatting
    notifications/ — QQ/completion notification system
    octto/        — Octto HTTP server, WebSocket, UI, auto-resume
    project-memory/ — SQLite-backed decisions/lessons/risks store
    skill-autopilot/ — Skill push-guard and stale-sweep
    tools/        — ToolDefinition factories (one directory per tool group)
    utils/        — Pure cross-cutting utilities
    config-loader.ts  — Merges opencode.json + micode.jsonc
    config-schemas.ts — Valibot schemas for all config files
    index.ts          — Composition root (plugin entry point)
  ```
- **Tests mirror `src/`** under `tests/` with `*.test.ts` suffix.
- **One agent per file** in `src/agents/`. Agent files export a named `XAgent: AgentConfig`.
- **Protocol constants** live in dedicated files: `atlas-mental-model.ts`, `project-memory-protocol.ts`, `knowledge-context-section.ts`. They are imported by agent files via template literal injection.
- **Sub-tool grouping**: when a tool family has multiple related definitions (e.g., `pty/spawn.ts`, `pty/write.ts`, `pty/read.ts`), group under a subdirectory with an `index.ts` that re-exports.
- **`src/utils/config.ts`** is the single source for all config constants. No magic numbers scattered across files — define named constants there or in the file that owns the concept.
- **`thoughts/`** directory structure: `thoughts/shared/designs/`, `thoughts/shared/plans/`, `thoughts/ledgers/`, `thoughts/lifecycle/`, `thoughts/octto/`. These are runtime artifacts, not source — git-ignored.

## Examples

### Agent file structure

```typescript
// src/agents/planner.ts — one agent per file, named export
import type { AgentConfig } from "@opencode-ai/sdk";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";

export const plannerAgent: AgentConfig = {
  description: "Creates micro-task plans optimized for parallel execution",
  mode: "subagent",
  temperature: 0.3,
  prompt: `...${ATLAS_MENTAL_MODEL_PROTOCOL}...${PROJECT_MEMORY_PROTOCOL}...`,
};
```

### Hooks barrel export

```typescript
// src/hooks/index.ts — barrel that defines the public hook API
export { createLedgerLoaderHook, findCurrentLedger, formatLedgerInjection } from "./ledger-loader";
export { createMindmodelInjectorHook } from "./mindmodel-injector";
export { createAutoCompactHook } from "./auto-compact";
// ... all hooks re-exported here; src/index.ts imports from @/hooks only
```

### Protocol constant file (single source)

```typescript
// src/agents/knowledge-context-section.ts
/**
 * Single source of truth for "本次知识上下文" subsection.
 * Injected verbatim into commander.ts, brainstormer.ts, octto.ts.
 * Drift guard in tests/agents/effect-first-reporting.test.ts.
 */
export const KNOWLEDGE_CONTEXT_SECTION = `<section name="本次知识上下文">
...
</section>
`;
```

## Anti-patterns

### Putting config constants inline in files

```typescript
// BAD: magic number with no named constant
if (context.usage > 0.7) { triggerCompaction(); }

// GOOD: constant in config.ts
export const config = { compaction: { threshold: 0.7 } };
// then:
if (context.usage > config.compaction.threshold) { triggerCompaction(); }
```

### Duplicating a protocol string in multiple agent files

```typescript
// BAD: copy-paste of protocol block in two agent files — will drift
// brainstormer.ts:
const ATLAS_BLOCK = `<atlas-mental-model>...</atlas-mental-model>`;
// executor.ts:
const ATLAS_BLOCK = `<atlas-mental-model>...</atlas-mental-model>`;

// GOOD: single source in atlas-mental-model.ts, imported and injected via template literal
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
prompt: `...${ATLAS_MENTAL_MODEL_PROTOCOL}...`
```
