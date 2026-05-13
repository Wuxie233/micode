# Coupling, Reuse & Design Constraints

## Rules

- **Low coupling**: modules depend only on the layer below them (utils ← tools ← hooks ← agents). No circular imports. No "reach up" from utils into tools.
- **No business classes**: use factory functions with closed-over state (`createX(ctx)`) instead of `class X`. Error subclasses (`class FooError extends Error`) are the only allowed classes.
- **Factory functions as the composition unit**: every tool, hook, store, and runner is created via a `createX` factory. This keeps state testable, avoids singleton pitfalls, and makes injection explicit.
- **Reuse protocol constants**: agent prompts share `ATLAS_MENTAL_MODEL_PROTOCOL`, `PROJECT_MEMORY_PROTOCOL`, `KNOWLEDGE_CONTEXT_SECTION` via import — never copy-paste. Tests enforce byte-identity.
- **Avoid stale Domain tags**: the valid Domain values are `frontend-ui`, `frontend-code`, `backend`, `general`. The bare string `"frontend"` is a stale-plan error — executor stops with a clear message.
- **Frozen API contract**: when a plan spans both frontend and backend tasks, the planner emits a contract file. Implementers must conform; they **never edit** the contract. Escalate mismatches to the executor.
- **Leaf agents do not write durable memory**: `implementer-*` and `reviewer` never call `project_memory_promote`, `project_memory_forget`, or write Atlas nodes. They escalate observations via their terminal report.
- **Context-brief propagation**: executor injects a `<context-brief>` block into every implementer/reviewer spawn prompt. Leaf agents trust the brief and do not re-do atlas_lookup or project_memory_lookup.
- **Maximum function size**: 40 non-comment, non-blank lines. Max nesting depth: 2. Cognitive complexity ≤ 10.
- **Early returns** over nested if-else: validate input at the top, return error early, keep happy path unindented.

## Examples

### Factory function (not class) for a runner

```typescript
// src/lifecycle/runner.ts
export function createLifecycleRunner(): LifecycleRunner {
  return {
    git: (args, options) => runCommand(GIT_BIN, args, options?.cwd),
    gh: (args, options) => runCommand(GH_BIN, args, options?.cwd),
  };
}
// Caller creates an instance; no singleton, no static state
const runner = createLifecycleRunner();
```

### Protocol constants imported and injected (not duplicated)

```typescript
// src/agents/brainstormer.ts
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";
import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";

export const brainstormerAgent: AgentConfig = {
  prompt: `
    ...brainstormer-specific instructions...
    ${ATLAS_MENTAL_MODEL_PROTOCOL}
    ${PROJECT_MEMORY_PROTOCOL}
    ${KNOWLEDGE_CONTEXT_SECTION}
  `,
};
// Tests in tests/agents/atlas-protocol-injection.test.ts enforce exactly-once injection
```

### Early return pattern (max depth 2)

```typescript
// src/project-memory/promote.ts
export async function promote(input: PromoteInput): Promise<PromoteOutcome> {
  if (!input.identity.projectId) {
    return { accepted: [], rejected: [], refusedReason: DEGRADED_IDENTITY_REASON };
  }
  const candidates = extractCandidates(input.markdown);
  if (candidates.length === 0) {
    return { accepted: [], rejected: [], refusedReason: null };
  }
  // happy path follows — no nesting needed
  const results = await Promise.all(candidates.map(c => processCandidate(input, c)));
  return mergeResults(results);
}
```

## Anti-patterns

### Business logic class

```typescript
// BAD: class for stateful workflow logic
class LifecycleOrchestrator {
  constructor(private runner: LifecycleRunner, private store: LifecycleStore) {}
  async start(summary: string) { ... }
  async finish() { ... }
}

// GOOD: factory returning a plain object or function
function createLifecycleOrchestrator(runner: LifecycleRunner, store: LifecycleStore) {
  return {
    start: async (summary: string) => { ... },
    finish: async () => { ... },
  };
}
```

### Stale Domain tag in a plan

```markdown
<!-- BAD: stale plan with bare "frontend" -->
- Domain: frontend
  File: src/components/Button.tsx

<!-- GOOD: use the current domain taxonomy -->
- Domain: frontend-ui
  File: src/components/Button.tsx
```

### Leaf agent writing project memory

```typescript
// BAD: implementer-backend directly promoting a decision
// (inside implementer-backend agent prompt or tool call)
await project_memory_promote({ markdown: "decided to use SQLite", ... });
// Leaf agents must NEVER do this

// GOOD: escalate via terminal report to executor
// "Project Memory observation: we chose SQLite for session storage — executor should promote"
```
