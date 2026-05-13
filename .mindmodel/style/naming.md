# Naming Conventions

## Rules

- **Source files**: `kebab-case.ts` — `ledger-loader.ts`, `atlas-mental-model.ts`, `config-schemas.ts`.
- **Directories**: domain nouns, kebab-case — `project-memory/`, `skill-autopilot/`, `atlas/`.
- **Tests**: mirror `src/` under `tests/`, with `*.test.ts` suffix — `tests/agents/atlas-mental-model.test.ts`.
- **Factories**: `createThing(ctx)` — `createLedgerLoaderHook(ctx)`, `createBatchReadTool(ctx)`, `createProjectMemoryStore(db)`.
- **Predicates**: `is`/`has`/`can`/`should` prefix — `isAbsolute(path)`, `isLookupHit(hit)`.
- **Interfaces**: PascalCase — `LedgerInfo`, `RunResult`, `ProjectMemoryStore`.
- **Types** (unions/aliases): PascalCase — `RepoKind`, `AtlasStatus`, `SourceKind`.
- **Enum-like maps**: `UPPER_SNAKE as const` object — `REPO_KIND`, `LIFECYCLE_STATES`, `ARTIFACT_KINDS`.
- **Unused params**: `_prefix` — `_unused`, `_ctx`.
- **Agent config exports**: kebab-case agent key matches the agent ID used in `spawn_agent` — `brainstormerAgent`, `executorAgent`, `plannerAgent`.
- **Module-level constants**: UPPER_SNAKE for true constants (`LOG_MODULE`, `EMPTY_OUTPUT`); camelCase for derived values.
- **Hook factories**: `createXHook(ctx: PluginInput)` → handler object or single function.
- **Tool factories**: `createXTool(ctx)` → `{ tool_name: ToolDefinition }` map or single `ToolDefinition`.

## Examples

### Factory + enum-like constant pattern

```typescript
// src/lifecycle/pre-flight.ts
export const REPO_KIND = {
  FORK: "fork",
  OWN: "own",
  UPSTREAM: "upstream",
  UNKNOWN: "unknown",
} as const;

export type RepoKind = (typeof REPO_KIND)[keyof typeof REPO_KIND];

export function createLifecycleRunner(): LifecycleRunner {
  return {
    git: (args, options) => runCommand(GIT_BIN, args, options?.cwd),
    gh: (args, options) => runCommand(GH_BIN, args, options?.cwd),
  };
}
```

### Predicate naming

```typescript
// src/project-memory/lookup.ts
function isLookupHit(hit: LookupHit | null): hit is LookupHit {
  return hit !== null;
}
```

### Named agent export matching agent ID

```typescript
// src/agents/executor.ts
export const executorAgent: AgentConfig = {
  description: "Executes plan with batch-first parallelism ...",
  mode: "subagent",
  temperature: 0.2,
  prompt: `...`,
};
// registered as "executor" in src/agents/index.ts
```

## Anti-patterns

### PascalCase source files

```
// BAD
src/utils/ErrorHandling.ts
src/agents/AtlasMentalModel.ts

// GOOD
src/utils/error-handling.ts
src/agents/atlas-mental-model.ts
```

### Class for business logic

```typescript
// BAD: class for stateful business logic — forbidden
class LedgerLoader {
  constructor(private ctx: PluginInput) {}
  load() { ... }
}

// GOOD: factory function with closed-over state
function createLedgerLoaderHook(ctx: PluginInput) {
  return async (messages: Message[]) => { ... };
}
```

### Magic strings inline

```typescript
// BAD: bare string literals for constants used in multiple places
const cmd = await run("git", ["remote", "get-url", "origin"]);

// GOOD: named constant
const GIT_ORIGIN_ARGS = ["remote", "get-url", "origin"] as const;
const cmd = await run(GIT_BIN, GIT_ORIGIN_ARGS);
```
