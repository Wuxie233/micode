# spawn_agent Argument Coercion Implementation Plan

**Goal:** Make `src/tools/spawn-agent.ts` tolerate common LLM argument shapes and return stable validation failures instead of crashing with `agents.map is not a function` or minified variants.

**Architecture:** Normalize the raw tool input at the `execute` boundary before any `.length`, index, or `.map` access. Use a small Valibot-backed helper to convert supported shapes into a single internal `readonly AgentTask[]` contract, then keep existing single-agent and parallel-agent execution behavior unchanged. Treat `tool.schema` as the tool UI and documentation hint, not the runtime safety boundary.

**Tech:** TypeScript ESM, `@/*` alias imports across folders, Valibot `v.*` schemas with `v.InferOutput`, `bun:test` mirrored under `tests/`, no classes, no `any`, named constants for messages and repeated strings.

**Design:** User-provided bug spec in this request. No separate `thoughts/shared/designs/` document exists for this hotfix.

**Contract:** No companion frontend/backend contract file. This is single-domain `general`; the argument compatibility contract is the matrix below.

---

## 不做的事

- 不批量改写已有 agent prompt 中的 84+ 处 `spawn_agent` 示例。运行时兼容层会覆盖现有语义。
- 不引入新依赖，不改 OpenCode SDK，不改上游 tool runtime。
- 不使用 class，不放宽到无校验透传，不用 `any`。
- 不 push，不开 PR，本轮只交付本地实现计划，末尾等待用户确认是否 push。

---

## Dependency Graph

```text
Wave 1 (serial foundation): 1.1
Wave 2 (serial integration): 2.1 depends on 1.1
```

当前 bug 只涉及一个工具和它的边界校验，任务必须串行以保持 TDD 顺序。没有可安全并发的实现任务。

---

## Tasks

### Wave 1: Argument normalizer foundation

#### Task 1.1: Create Valibot argument normalizer

**Domain:** general  
**Path:** `src/tools/spawn-agent-args.ts`  
**Modify type:** create  
**Test:** `tests/tools/spawn-agent-args.test.ts`  
**Depends:** none  
**Estimated lines:** implementation +90 to +120, test +120 to +160

**Diff description:**

1. Create a kebab-case helper module for the spawn-agent argument boundary. Define `AgentTaskSchema` with `agent`, `prompt`, and `description` as strings, derive `AgentTask` via `v.InferOutput`, and expose a discriminated parse result from `normalizeSpawnAgentArgs(input: unknown)`.
2. Support these normalized candidates: top-level task object, `{ agents: task }`, top-level task array, and `{ agents: task[] }`. If a record has an `agents` key, that key takes precedence over top-level task fields to avoid ambiguous payloads.
3. Return stable failure results for invalid or empty input instead of throwing. Use named constants for the two user-facing messages: no agents specified, and invalid spawn-agent arguments.

**TDD notes:**

- First add tests that fail on the missing helper.
- Cover all four accepted shapes, empty array and `{ agents: [] }`, missing field, wrong field type, non-object input, and ambiguous payload where `agents` is invalid but top-level fields are valid.
- Assert output arrays are normalized in order and invalid cases never require callers to catch exceptions.

**Verify:**

```bash
PATH=/opt/openclaw/runtime/global/bin:$PATH bun test tests/tools/spawn-agent-args.test.ts
```

---

### Wave 2: Tool execute integration

#### Task 2.1: Normalize spawn_agent execute args before runtime access

**Domain:** general  
**Path:** `src/tools/spawn-agent.ts`  
**Modify type:** modify  
**Test:** `tests/tools/spawn-agent.test.ts`  
**Depends:** 1.1  
**Estimated lines:** implementation +35 to +60 and -10 to -25, test +130 to +180

**Diff description:**

1. Import the normalizer and `AgentTask` type from `@/tools/spawn-agent-args`. Change the `execute` parameter handling so it accepts raw unknown input, normalizes it, and only then checks array length or calls `runParallelAgents`.
2. On parse failure return the stable formatted `spawn_agent Failed` message. On empty normalized tasks return the existing no-agents failure message. Do not throw for user-shape errors, so the workflow can continue.
3. Preserve existing behavior after normalization: one task uses `runAgent`, two or more tasks use `runParallelAgents`, progress metadata still reports the chosen agent count, and `Promise.all` still only receives a real array.
4. Update the tool description and, if the plugin `tool.schema` API supports it, make the schema permissive enough to document optional top-level `agent`, `prompt`, and `description` fields in addition to canonical `agents`. If the SDK schema API cannot express unions or unknown top-level arrays, keep canonical schema documentation but keep runtime normalization as the source of truth.

**TDD notes:**

- Use an in-memory fake `PluginInput` client that returns one assistant message and records session prompts. Do not spy on private helpers.
- Test `execute` with all four accepted shapes and assert no `.map` crash occurs.
- Test invalid shapes and empty shapes return stable failure text and do not call `client.session.create`.
- Test a two-task canonical array still returns the parallel completion header and preserves task order in output.

**Verify:**

```bash
PATH=/opt/openclaw/runtime/global/bin:$PATH bun test tests/tools/spawn-agent.test.ts
```

---

## Contract Matrix

| Input shape | Example shape | Expected behavior | Error contract |
|---|---|---|---|
| Canonical wrapped array | `{ agents: [{ agent, prompt, description }] }` | Auto compatible. Normalize to the same ordered array. Length 1 runs `runAgent`; length greater than 1 runs `runParallelAgents`. | none |
| Top-level single task | `{ agent, prompt, description }` | Auto compatible. Normalize to `[task]` and run as a single agent. | none |
| Wrapped single task object | `{ agents: { agent, prompt, description } }` | Auto compatible. Normalize to `[task]` and run as a single agent. | none |
| Top-level task array | `[{ agent, prompt, description }]` | Auto compatible if the raw execute boundary receives the array. Normalize to the same ordered array. | none |
| Empty canonical array | `{ agents: [] }` | Do not call session API. Return a recoverable tool failure. | `## spawn_agent Failed` plus `No agents specified.` |
| Empty top-level array | `[]` | Do not call session API. Return a recoverable tool failure. | `## spawn_agent Failed` plus `No agents specified.` |
| Missing required field | `{ agent, prompt }` or `{ agents: [{ agent, description }] }` | Do not call session API. Return a recoverable validation failure. | `## spawn_agent Failed` plus clear text saying each task requires string `agent`, `prompt`, and `description` |
| Wrong field type | `{ agents: [{ agent: 1, prompt, description }] }` | Do not call session API. Return a recoverable validation failure. | Same invalid-arguments message |
| Wrong container type | `{ agents: "implementer" }`, `null`, `42`, `{}` | Do not call session API. Return a recoverable validation failure. | Same invalid-arguments message |
| Ambiguous object with `agents` key | `{ agent, prompt, description, agents: "bad" }` | `agents` key wins. Return validation failure rather than silently ignoring the explicit `agents` value. | Same invalid-arguments message |

**Stable failure text target:** invalid shapes must never expose JavaScript internals such as `map is not a function`, `agents2.map`, Valibot stack traces, or minified variable names.

---

## Verification

Task-level verification:

```bash
PATH=/opt/openclaw/runtime/global/bin:$PATH bun test tests/tools/spawn-agent-args.test.ts
PATH=/opt/openclaw/runtime/global/bin:$PATH bun test tests/tools/spawn-agent.test.ts
```

Required acceptance gate before any commit:

```bash
PATH=/opt/openclaw/runtime/global/bin:$PATH bun run check
```

This gate must be fully green: `biome check .`, `eslint .`, `bun run typecheck`, and `bun test`.

Manual sanity check after tests pass:

- Inspect the final `src/tools/spawn-agent.ts` and confirm no code path reads `agents.length`, `agents[0]`, or calls `agents.map` before the Valibot normalizer returns success.
- Confirm tests assert stable failure text rather than expecting thrown exceptions.

---

## Risks

1. **Existing prompt call-site semantics:** many agent prompts show Task-like `spawn_agent(agent="...", prompt="...", description="...")` examples. This change intentionally makes those shapes safe. It should not change canonical `{ agents: [...] }` behavior.
2. **`tool.schema` versus runtime validation:** if the plugin SDK rejects top-level arrays before `execute`, direct runtime normalization cannot help that exact transport path. The implementation should make the schema as permissive as the available API allows, while tests lock the execute boundary. If SDK support is insufficient, document top-level array as best-effort but still keep it safe whenever received.
3. **Valibot schema strictness:** adding non-empty string constraints would be a behavior change because current `tool.schema.string()` accepts empty strings. Keep required type checks only, and preserve `agents: []` as the special no-agents message.
4. **Minified variable names:** the root crash surfaced as `agents2.map` after minification. Normalizing before any `.map` access removes dependence on variable names and gives stable user-facing messages.
5. **Lint constraints:** helper functions must stay under 40 lines, nesting at or below 2, cognitive complexity at or below 10, no nested ternary, no Hungarian suffixes such as `TaskList` or `ParseFn`, and no duplicated message literals beyond the configured threshold.
6. **Testing fake client:** tests should use a deterministic in-memory fake client and assert observable tool output and prompt calls. Avoid brittle assertions against private helper internals.

---

## Commit Strategy

Preferred: one commit after `bun run check` is green.

```text
fix(spawn-agent): normalize LLM argument shapes

Root cause: spawn_agent assumed args.agents was always an array. When LLM calls used Task-like top-level fields, { agents: task }, or a top-level array, schema validation did not protect the execute path before .map, so the workflow crashed with agents.map is not a function or minified agents2.map is not a function.

Covered shapes: canonical { agents: [...] }, top-level single task, wrapped single task, and top-level array. Invalid and empty shapes now return stable spawn_agent failure messages instead of throwing.
```

Optional split, still no more than 2 commits and no issue ref because micode issues are disabled:

1. `test(spawn-agent): lock argument coercion contract`
2. `fix(spawn-agent): normalize LLM argument shapes`

If using the optional split, do not leave a failing commit as the final branch state. Run the full acceptance gate after the second commit.

---

## Push Decision

Do not push and do not open a PR in this round. `origin` is the fork `Wuxie233/micode`, upstream is `vtemian/micode`. 等用户确认是否 push。
