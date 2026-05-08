---
date: 2026-05-08
topic: "Split Frontend Workflow Routing"
issue: 56
scope: agents
contract: none
---

# Split Frontend Workflow Routing Implementation Plan

**Goal:** Replace the single `frontend` task class with `frontend-ui` and `frontend-code`, route each to a dedicated implementer agent, and treat the literal `frontend` value as a stale-plan error.

**Architecture:** Two new implementer agents (`implementer-frontend-ui`, `implementer-frontend-code`) are added alongside the existing `implementer-backend` / `implementer-general`. The planner classifies tasks into `frontend-ui | frontend-code | backend | general`. The executor's dispatch table maps each new domain to its dedicated implementer, keeps `backend` and `general` unchanged, falls back to `implementer-general` for unknown values, and fails the run with a clear stale-plan error when the literal `frontend` value appears. Cross-domain contract generation triggers when the plan contains any `frontend-*` task plus any `backend` task.

**Design:** [thoughts/shared/designs/2026-05-08-split-frontend-routing-design.md](../designs/2026-05-08-split-frontend-routing-design.md)

**Contract:** none (this plan does not introduce HTTP/API surfaces; it is workflow/prompt configuration. All affected files are under `src/agents/`, `src/tools/spawn-agent/`, `src/utils/`, `tests/`, and docs — no frontend/backend split in the runtime sense.)

**Domain note for this plan:** Although the topic is "frontend workflow routing", every task here modifies plugin runtime/prompt/test/doc files. By the planner's domain rules, all of these are `general` (cross-cutting plugin code, prompts, configs, tests, docs). No task in this plan is a real `frontend-ui` or `frontend-code` task in the post-change classification.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [foundation - new agent files + role/title labels - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [core - registry, planner, executor, commander - depends on batch 1]
Batch 3 (parallel): 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 [delete old frontend module + test updates - depends on batch 2]
Batch 4 (parallel): 4.1, 4.2, 4.3, 4.4, 4.5 [docs + config example + spawn-agent test fixtures - depends on batch 2]
```

Rationale:
- Batch 1 introduces the two new implementer modules and updates the role-label / title-source string lists. These are independent of each other (different files) and have no upstream dependencies.
- Batch 2 wires Batch 1 into the registry and updates the prompts that reference the old `frontend` domain and `implementer-frontend` agent. All Batch 2 tasks touch different files.
- Batch 3 deletes the old `src/agents/implementer-frontend.ts` module (Task 3.0, safe because Task 2.1 has already removed its import from the registry) and updates the test files that assert against the prompts and registry from Batch 2.
- Batch 4 updates docs, the user-facing config example, and the spawn-agent test fixtures (which use agent name strings that became invalid). Independent of Batch 3 because they touch different files.

---

## Batch 1: Foundation (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: New `implementer-frontend-ui` agent module
**File:** `src/agents/implementer-frontend-ui.ts`
**Test:** none (prompt-only agent string; behavior is exercised by `tests/agents/implementer-domain.test.ts` after Batch 3 updates)
**Depends:** none
**Domain:** general

Reasoning: This is a new sibling of `src/agents/implementer-frontend.ts`. The existing frontend variant's `domainSuffix` is replaced by a UI/UX-focused suffix. It still wraps `createImplementerAgent` from `./implementer.ts`, so it inherits `BASE_IMPLEMENTER_PROMPT` and the contract-read-first rule. The suffix emphasises design-system tokens, semantic structure, visual hierarchy, responsive behaviour, accessibility, motion, and interaction detail. File-pattern signals stay the same as the old frontend variant since both UI and code-logic frontend tasks live in the same file types; the meaningful difference is in `<implementation-preferences>` and `<domain>` description.

```typescript
import type { AgentConfig } from "@opencode-ai/sdk";

import { createImplementerAgent } from "./implementer";

const FRONTEND_UI_SUFFIX = `

<domain-constraints priority="high">
  <domain>Frontend UI: page layout, styling, visual hierarchy, accessibility polish, animation, interaction design, and design-system use</domain>

  <file-patterns>
    <match>*.tsx, *.jsx, *.vue, *.svelte (when the task is UI/layout/visual)</match>
    <match>*.css, *.scss, *.sass, *.module.css, *.styled.ts</match>
    <match>components/**, styles/**, ui/**, pages/**, app/** (when client-facing)</match>
    <match>design-system/**, theme/**, tokens/**</match>
  </file-patterns>

  <implementation-preferences>
    <prefer>Use the project's existing design-system tokens and components; do not invent ad-hoc styles when a token exists</prefer>
    <prefer>Semantic HTML and accessible markup: correct landmarks, headings, labels, focus order, and ARIA only where semantics are insufficient</prefer>
    <prefer>Keyboard-reachable interactions, visible focus states, and color contrast that meets the project's accessibility target</prefer>
    <prefer>Responsive behavior: define behavior across the project's documented breakpoints, not just one size</prefer>
    <prefer>Motion and transitions that match the project's existing animation language; respect prefers-reduced-motion</prefer>
    <prefer>Match the project's existing CSS-in-JS or utility-first conventions; do not introduce a new styling system</prefer>
  </implementation-preferences>

  <escalate-if>
    <situation>Task file path clearly belongs to backend (src/api/, src/server/, *.sql, middleware/)</situation>
    <situation>Task is primarily frontend code-logic (state machines, data flow, form validation, complex event handling, type fixes, frontend tests). Those belong to implementer-frontend-code, not here</situation>
    <situation>Plan instructs generating server-side handlers, DB queries, or infrastructure code</situation>
  </escalate-if>

  <api-contract-rule priority="critical">
    <rule>If a Contract file is referenced in the task prompt, READ IT BEFORE writing any code that touches HTTP, WebSocket, or API calls</rule>
    <rule>Your API request URLs, HTTP methods, request body shapes, and expected response shapes MUST match the contract exactly</rule>
    <rule>If you find a mismatch between plan code and contract, ESCALATE. Do NOT modify the contract; it is the shared source of truth</rule>
  </api-contract-rule>
</domain-constraints>`;

export const implementerFrontendUiAgent: AgentConfig = createImplementerAgent({
  description: "Frontend UI implementer: page/UI/UX, layout, styling, accessibility, motion, design-system use",
  domainSuffix: FRONTEND_UI_SUFFIX,
});
```

**Verify:** `bun run typecheck` (no test for this file alone; Batch 3 tests cover registration and prompt-string assertions)
**Commit:** none (executor batches commits at the end)

---

### Task 1.2: New `implementer-frontend-code` agent module
**File:** `src/agents/implementer-frontend-code.ts`
**Test:** none (prompt-only agent string; behavior covered by `tests/agents/implementer-domain.test.ts` updates in Batch 3)
**Depends:** none
**Domain:** general

Reasoning: Sibling of Task 1.1. The suffix emphasises correctness and maintainability over visual polish: minimal scoped changes, frontend state/data flow, event logic, type safety, tests, and explicit non-modification of UI markup unless the task requires it.

```typescript
import type { AgentConfig } from "@opencode-ai/sdk";

import { createImplementerAgent } from "./implementer";

const FRONTEND_CODE_SUFFIX = `

<domain-constraints priority="high">
  <domain>Frontend code-logic: client-side logic, state and data flow, forms, event behavior, type fixes, frontend tests, and small engineering changes</domain>

  <file-patterns>
    <match>*.ts, *.tsx, *.js, *.jsx, *.vue, *.svelte (when the task is logic/state/types/tests)</match>
    <match>hooks/**, stores/**, state/**, contexts/**</match>
    <match>utils/**, lib/** (when client-side)</match>
    <match>tests/components/**, tests/hooks/**, tests/frontend/** and other frontend test files</match>
  </file-patterns>

  <implementation-preferences>
    <prefer>Minimal, scoped changes. Do not refactor or restyle UI that the task did not ask you to change</prefer>
    <prefer>Preserve existing markup, class names, and visual behavior unless the task explicitly requires a visible change</prefer>
    <prefer>Strong typing: prefer narrow types, avoid any, fix type errors at the source rather than casting them away</prefer>
    <prefer>Pure, testable functions for state transitions and validators; isolate side effects</prefer>
    <prefer>Use the project's existing state, data-fetching, and form solutions; do not introduce a new library</prefer>
    <prefer>Frontend tests follow the project's existing test conventions and runner</prefer>
  </implementation-preferences>

  <escalate-if>
    <situation>Task file path clearly belongs to backend (src/api/, src/server/, *.sql, middleware/)</situation>
    <situation>Task is primarily UI/UX/visual: layout, styling, accessibility polish, motion, design-system work. Those belong to implementer-frontend-ui, not here</situation>
    <situation>Plan instructs generating server-side handlers, DB queries, or infrastructure code</situation>
  </escalate-if>

  <api-contract-rule priority="critical">
    <rule>If a Contract file is referenced in the task prompt, READ IT BEFORE writing any code that touches HTTP, WebSocket, or API calls</rule>
    <rule>Your API request URLs, HTTP methods, request body shapes, and expected response shapes MUST match the contract exactly</rule>
    <rule>If you find a mismatch between plan code and contract, ESCALATE. Do NOT modify the contract; it is the shared source of truth</rule>
  </api-contract-rule>
</domain-constraints>`;

export const implementerFrontendCodeAgent: AgentConfig = createImplementerAgent({
  description: "Frontend code-logic implementer: state, data flow, forms, events, type fixes, frontend tests",
  domainSuffix: FRONTEND_CODE_SUFFIX,
});
```

**Verify:** `bun run typecheck`
**Commit:** none

---

### Task 1.3: Update `agent-roles.ts` Chinese role labels
**File:** `src/tools/spawn-agent/agent-roles.ts`
**Test:** `tests/tools/spawn-agent/agent-roles.test.ts` (Test field is not "none": this is exported reusable label-resolution logic, behavioral risk is meaningful — Batch 3 Task 3.5 updates the existing test file)
**Depends:** none
**Domain:** general

Reasoning: The role-label map drives Chinese display labels in spawn-agent diagnostics, conversation titles, and session tracking. We must add `implementer-frontend-ui` and `implementer-frontend-code`, and remove the old `implementer-frontend` entry so a stray spawn (which should never happen after the registry change) does not silently get a friendly label. The map preserves all unrelated entries.

Decision: Two new labels are `前端UI实现` and `前端代码实现`. They mirror the existing `后端实现 / 前端实现 / 通用实现` pattern, are short enough for table columns, and disambiguate the two new variants without breaking the visual parallel.

Implementation (full replacement of the `AGENT_ROLE_LABELS` constant only; rest of file unchanged):

```typescript
const SPAWN_AGENT_PREFIX = "spawn-agent.";
const GENERIC_FALLBACK = "子任务";

export const AGENT_ROLE_LABELS: Readonly<Record<string, string>> = {
  "implementer-backend": "后端实现",
  "implementer-frontend-ui": "前端UI实现",
  "implementer-frontend-code": "前端代码实现",
  "implementer-general": "通用实现",
  reviewer: "代码审查",
  planner: "规划",
  brainstormer: "方案探索",
  executor: "执行调度",
  commander: "总指挥",
  critic: "对抗审查",
  "product-manager": "产品经理",
  "software-architect": "软件架构师",
  "ux-designer": "UX 设计师",
  "architecture-quality-inspector": "架构质检",
  "rubric-reviewer": "Rubric 评审",
  "codebase-analyzer": "代码分析",
  "codebase-locator": "代码定位",
  "pattern-finder": "模式查找",
};

function stripSpawnAgentPrefix(value: string): string {
  return value.startsWith(SPAWN_AGENT_PREFIX) ? value.slice(SPAWN_AGENT_PREFIX.length) : value;
}

export function agentRoleLabel(agent: string): string {
  const trimmed = agent.trim();
  if (trimmed.length === 0) return GENERIC_FALLBACK;

  const cleaned = stripSpawnAgentPrefix(trimmed);
  if (cleaned.length === 0) return GENERIC_FALLBACK;

  return AGENT_ROLE_LABELS[cleaned] ?? cleaned;
}
```

**Verify:** `bun test tests/tools/spawn-agent/agent-roles.test.ts` (after Batch 3 Task 3.5 updates the test)
**Commit:** none

---

### Task 1.4: Update `conversation-title/source.ts` tool/agent name list
**File:** `src/utils/conversation-title/source.ts`
**Test:** none (string-list change; this is a low-information-message filter, not exported reusable logic with behavioral branches that change)
**Depends:** none
**Domain:** general

Reasoning: `TOOL_AND_AGENT_NAMES` is used to detect tool-like / agent-like topic strings so the conversation-title heuristic does not let bare agent names become a conversation title. We replace `implementer-frontend` with the two new names; everything else is unchanged.

Implementation (full replacement of `TOOL_AND_AGENT_NAMES` constant only; the rest of the file is unchanged):

```typescript
const TOOL_AND_AGENT_NAMES = [
  "spawn-agent",
  "spawn_agent",
  "implementer-frontend-ui",
  "implementer-frontend-code",
  "implementer-backend",
  "implementer-general",
  "executor",
  "reviewer",
  "codebase-locator",
  "codebase-analyzer",
  "pattern-finder",
  "planner",
  "brainstormer",
  "octto",
  "commander",
] as const;
```

**Verify:** `bun run typecheck`
**Commit:** none

---

## Batch 2: Wiring (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Update agent registry `src/agents/index.ts`
**File:** `src/agents/index.ts`
**Test:** `tests/agents/implementer-domain.test.ts` (registry presence/absence assertions are exported runtime behavior — Batch 3 Task 3.4 updates the test)
**Depends:** 1.1, 1.2
**Domain:** general

Reasoning: Replace the `implementer-frontend` import + registry entry + barrel re-export with two new entries for `implementer-frontend-ui` and `implementer-frontend-code`. Keep `implementer-backend` and `implementer-general` exactly as-is. The unsuffixed `implementerAgent` import from `./implementer` is no longer needed (it was already not registered in the public `agents` map; verify by reading the existing index.ts before editing). After this task, `agents["implementer-frontend"]` MUST be undefined.

Surgical edits (all in `src/agents/index.ts`):

1. Replace the import line:

```typescript
// BEFORE
import { implementerFrontendAgent } from "./implementer-frontend";
// AFTER
import { implementerFrontendCodeAgent } from "./implementer-frontend-code";
import { implementerFrontendUiAgent } from "./implementer-frontend-ui";
```

2. Replace the registry entry inside the `agents` record. Find the existing line:

```typescript
"implementer-frontend": { ...implementerFrontendAgent, model: DEFAULT_MODEL },
```

Replace it with two lines (keep them adjacent, alphabetically by suffix):

```typescript
"implementer-frontend-ui": { ...implementerFrontendUiAgent, model: DEFAULT_MODEL },
"implementer-frontend-code": { ...implementerFrontendCodeAgent, model: DEFAULT_MODEL },
```

3. Replace the barrel re-export entry. Find the line:

```typescript
implementerFrontendAgent,
```

inside the `export { ... }` block (currently positioned between `plannerAgent,` and `implementerBackendAgent,`). Replace it with:

```typescript
implementerFrontendUiAgent,
implementerFrontendCodeAgent,
```

No other line in `src/agents/index.ts` changes. Imports for backend/general/etc. and the rest of the agents map are untouched.

**Verify:** `bun test tests/agents/implementer-domain.test.ts tests/config-loader-integration.test.ts` (after Batch 3 updates) and `bun run typecheck`
**Commit:** none

---

### Task 2.2: Update planner prompt in `src/agents/planner.ts`
**File:** `src/agents/planner.ts`
**Test:** `tests/agents/planner-domain.test.ts` and `tests/agents/planner-contract.test.ts` (these read the file source directly — Batch 3 Tasks 3.1 and 3.2 update them)
**Depends:** none (does not import from Batch 1)
**Domain:** general

Reasoning: Three prompt blocks need to know about the new domain set:
1. `<domain-classification>` — replace the `<frontend>` block with `<frontend-ui>` and `<frontend-code>`. Keep `<backend>` and `<general>` exactly as-is.
2. `<contract-trigger>` — change "Plan has >= 1 Domain: frontend task AND >= 1 Domain: backend task" to use both frontend domains.
3. `<contract-self-check>` — same: each "frontend task" reference becomes "frontend-ui or frontend-code task".
4. The skeleton template `**Domain:** frontend | backend | general` line and the `<principle name="domain-tagged">` description must be updated.
5. The `<contract-shared-types-task>` text "frontend and backend tasks" stays as a phrase about contract participants; specify it as "frontend-ui/frontend-code and backend tasks" for clarity.

Edit instructions (apply these surgical edits in order; do not rewrite the whole file):

**Edit A — `<domain-classification>` opening line and `<frontend>` block.**

Find:

```
EVERY micro-task MUST carry a Domain field with one of: frontend | backend | general.
```

Replace with:

```
EVERY micro-task MUST carry a Domain field with one of: frontend-ui | frontend-code | backend | general.
```

Find the entire `<frontend description="UI layer, visual and interactive surfaces, client-side code">` block (3 signal lines, ending with `</frontend>`) and replace it with these two blocks:

```
  <frontend-ui description="Page, layout, styling, visual hierarchy, accessibility polish, animation, interaction design, design-system use">
    <signal>File extension: .tsx, .jsx, .vue, .svelte (when the task is UI/layout/visual)</signal>
    <signal>File extension: .css, .scss, .sass, .module.css, *.styled.ts</signal>
    <signal>Path contains: components/, styles/, ui/, pages/, app/ (when client-facing), design-system/, theme/, tokens/</signal>
    <signal>Responsibility: visual hierarchy, layout, styling, accessibility polish, motion/animation, interaction design, responsive behavior</signal>
  </frontend-ui>

  <frontend-code description="Frontend logic, state, data flow, events, type fixes, frontend tests, small engineering changes">
    <signal>File extension: .ts, .tsx, .js, .jsx, .vue, .svelte (when the task is logic/state/types/tests, not visual)</signal>
    <signal>Path contains: hooks/, stores/, state/, contexts/, utils/ (client-side), lib/ (client-side), tests/components/, tests/hooks/, tests/frontend/</signal>
    <signal>Responsibility: client-side logic, state and data flow, forms, event behavior, type safety, frontend tests, bug fixes that do not alter visible UI</signal>
  </frontend-code>
```

**Edit B — Add tie-breaker rule after the new `<frontend-code>` block, before `<backend>`.**

Insert this block immediately before the existing `<backend description=...>` line:

```
  <frontend-tiebreaker>
    <rule>When a frontend task is ambiguous, prefer frontend-code if correctness or type safety is the main risk; prefer frontend-ui if user-visible design quality is the main goal</rule>
    <rule>If one task bundles both UI/UX changes and code-logic changes, SPLIT it into two tasks (one frontend-ui, one frontend-code) rather than choosing one domain</rule>
  </frontend-tiebreaker>
```

**Edit C — `<rule>` lines under `<domain-classification>`.**

Find:

```
<rule>Every Task node in the output MUST contain a "**Domain:**" line with exactly one of: frontend, backend, general</rule>
```

Replace with:

```
<rule>Every Task node in the output MUST contain a "**Domain:**" line with exactly one of: frontend-ui, frontend-code, backend, general</rule>
```

The next two rules (`Domain is determined by the PRIMARY file...` and `When in doubt, prefer general...`) are unchanged.

**Edit D — `<contract-generation>` opening sentence.**

Find:

```
When the plan contains BOTH at least one Domain: frontend task AND at least one Domain: backend task,
you MUST produce a companion CONTRACT document alongside the plan.
```

Replace with:

```
When the plan contains BOTH at least one Domain: frontend-ui or Domain: frontend-code task AND at least one Domain: backend task,
you MUST produce a companion CONTRACT document alongside the plan.
```

**Edit E — `<contract-trigger>` condition.**

Find:

```
<condition>Plan has >= 1 Domain: frontend task AND >= 1 Domain: backend task</condition>
```

Replace with:

```
<condition>Plan has >= 1 task with Domain: frontend-ui or Domain: frontend-code, AND >= 1 task with Domain: backend</condition>
```

**Edit F — `<contract-self-check>` four `<check>` lines that mention "frontend task" or "backend task".**

Replace these lines exactly:

```
<check>Every API path or fetch URL referenced in any frontend task exists as an endpoint in the contract</check>
<check>Every handler route created in any backend task has a matching entry in the contract's HTTP Endpoints table</check>
<check>Every request body type referenced by frontend tasks matches the request schema in the contract</check>
<check>Every response body shape returned by backend tasks matches the response schema in the contract</check>
<check>Field names, types, and optionality are consistent across frontend usage, backend implementation, and the contract</check>
```

with:

```
<check>Every API path or fetch URL referenced in any frontend-ui or frontend-code task exists as an endpoint in the contract</check>
<check>Every handler route created in any backend task has a matching entry in the contract's HTTP Endpoints table</check>
<check>Every request body type referenced by frontend-ui or frontend-code tasks matches the request schema in the contract</check>
<check>Every response body shape returned by backend tasks matches the response schema in the contract</check>
<check>Field names, types, and optionality are consistent across frontend (ui or code) usage, backend implementation, and the contract</check>
```

**Edit G — `<contract-shared-types-task>` first sentence.**

Find:

```
If the contract defines 3 or more shared types used by both frontend and backend tasks, ADD one extra task:
```

Replace with:

```
If the contract defines 3 or more shared types used by both frontend (ui or code) and backend tasks, ADD one extra task:
```

The line `Placed in Batch 1 (foundation), so frontend and backend tasks in later batches can import from it` is unchanged in spirit; replace it with:

```
- Placed in Batch 1 (foundation), so frontend (ui or code) and backend tasks in later batches can import from it
```

**Edit H — Skeleton template `**Domain:**` line in `<task-node-format>`.**

Find:

```
**Domain:** frontend | backend | general
```

Replace with:

```
**Domain:** frontend-ui | frontend-code | backend | general
```

**Edit I — Principles list.**

Find:

```
<principle name="domain-tagged">Every task carries a Domain tag (frontend, backend, or general); the executor dispatches based on this tag</principle>
<principle name="contract-when-cross-domain">Produce a companion contract file whenever the plan spans both frontend and backend</principle>
```

Replace with:

```
<principle name="domain-tagged">Every task carries a Domain tag (frontend-ui, frontend-code, backend, or general); the executor dispatches based on this tag</principle>
<principle name="contract-when-cross-domain">Produce a companion contract file whenever the plan spans both a frontend domain (frontend-ui or frontend-code) and backend</principle>
```

No other lines in `src/agents/planner.ts` change.

**Verify:** `bun test tests/agents/planner-domain.test.ts tests/agents/planner-contract.test.ts` (after Batch 3 updates) and `bun run typecheck`
**Commit:** none

---

### Task 2.3: Update executor prompt in `src/agents/executor.ts`
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-dispatch.test.ts` (Batch 3 Task 3.3 updates the test; the test inspects the prompt source directly)
**Depends:** none (string changes only)
**Domain:** general

Reasoning: The executor prompt has six places that reference the old single `frontend` domain or the old `implementer-frontend` agent name. We must:
1. Update the available-agents list at the top.
2. Update the `<domain-dispatch>` table to map both new domains.
3. Add a `<stale-frontend-guard>` block that fails the run with a clear instruction when the literal `frontend` value appears.
4. Keep the existing `<fallback>` for unknown values (not for the literal `frontend`).
5. Update the `<subagent-tools>` agent-list comment.
6. Add `<subagent name="implementer-frontend-ui">` and `<subagent name="implementer-frontend-code">` entries in `<available-subagents>`, replacing the old `<subagent name="implementer-frontend">`.
7. Update the execution-example so it dispatches one task to `implementer-frontend-ui` and one to `implementer-frontend-code` instead of two to `implementer-frontend`.

Edit instructions (apply in order):

**Edit A — Available-agents banner near top of prompt.**

Find:

```
Available micode agents: implementer-frontend, implementer-backend, implementer-general, reviewer, codebase-locator, codebase-analyzer, pattern-finder.
```

Replace with:

```
Available micode agents: implementer-frontend-ui, implementer-frontend-code, implementer-backend, implementer-general, reviewer, codebase-locator, codebase-analyzer, pattern-finder.
```

**Edit B — `<subagent-tools>` agent-list line.**

Find:

```
  - agent: The agent type, one of: "implementer-frontend", "implementer-backend", "implementer-general", "reviewer"
```

Replace with:

```
  - agent: The agent type, one of: "implementer-frontend-ui", "implementer-frontend-code", "implementer-backend", "implementer-general", "reviewer"
```

**Edit C — `<dispatch-table>` inside `<domain-dispatch>`.**

Find:

```
<dispatch-table>
  <map from="frontend" to="implementer-frontend"/>
  <map from="backend" to="implementer-backend"/>
  <map from="general" to="implementer-general"/>
</dispatch-table>
```

Replace with:

```
<dispatch-table>
  <map from="frontend-ui" to="implementer-frontend-ui"/>
  <map from="frontend-code" to="implementer-frontend-code"/>
  <map from="backend" to="implementer-backend"/>
  <map from="general" to="implementer-general"/>
</dispatch-table>
```

**Edit D — Add a `<stale-frontend-guard>` block immediately AFTER the `</dispatch-table>` line and BEFORE the existing `<fallback>` block.**

Insert this block:

```
<stale-frontend-guard priority="critical">
  <rule>If ANY task has the literal value "**Domain:** frontend" (the old, single-frontend value with no -ui/-code suffix), STOP. Do not silently fall back to implementer-general or any other agent.</rule>
  <rule>Treat the plan as STALE and report BLOCKED with this message: "Plan is stale: Domain: frontend is no longer a supported value. Re-run planner so frontend tasks receive Domain: frontend-ui or Domain: frontend-code." Include the task IDs that still use Domain: frontend.</rule>
  <rule>This guard runs BEFORE the unknown-domain fallback. The literal "frontend" value is not unknown, it is known-stale.</rule>
</stale-frontend-guard>
```

**Edit E — `<fallback>` block: clarify it does NOT cover the literal `frontend`.**

Find:

```
<fallback>
If a task has NO Domain line (old plans generated before domain routing was added),
or if the value is not one of frontend/backend/general, default to implementer-general.
</fallback>
```

Replace with:

```
<fallback>
If a task has NO Domain line (very old plans generated before domain routing was added),
or if the value is unrecognized AND not the known-stale literal "frontend",
default to implementer-general. The literal "frontend" value is handled by stale-frontend-guard above and must NOT reach this fallback.
</fallback>
```

**Edit F — `<parsing>` instruction inside `<domain-dispatch>`.**

Find:

```
Look for the exact line: "**Domain:** X" where X is frontend, backend, or general.
```

Replace with:

```
Look for the exact line: "**Domain:** X" where X is frontend-ui, frontend-code, backend, or general.
```

**Edit G — `<never>` block inside `<domain-dispatch>`.**

Find:

```
<forbidden>NEVER cross-dispatch: do not send a frontend task to implementer-backend or vice versa</forbidden>
```

Replace with:

```
<forbidden>NEVER cross-dispatch: do not send a frontend-ui or frontend-code task to implementer-backend, and do not send a backend task to either frontend implementer</forbidden>
<forbidden>NEVER substitute implementer-frontend-ui for implementer-frontend-code or vice versa; route by the explicit Domain value</forbidden>
```

**Edit H — `<available-subagents>` list. Replace the entire `<subagent name="implementer-frontend">...</subagent>` block with two new blocks.**

Find the existing block (currently the first subagent inside `<available-subagents>`):

```
  <subagent name="implementer-frontend">
    Frontend-domain implementer: React/Vue/Svelte, CSS, UI components, client-side state.
    Use when task Domain is "frontend".
    <invocation>
      spawn_agent(agent="implementer-frontend", prompt="<spawn-meta task-id=\"2026-04-24-users:batch2:2.3:implementer:src/components/UserCard.tsx\" run-id=\"<your-session-id>\" generation=\"1\" />\nImplement task 2.3: Create src/components/UserCard.tsx with test. [code] **Contract:** thoughts/shared/plans/2026-04-24-users-contract.md", description="Task 2.3")
    </invocation>
  </subagent>
```

Replace with:

```
  <subagent name="implementer-frontend-ui">
    Frontend UI implementer: page/UI/UX, layout, styling, accessibility, motion, design-system use.
    Use when task Domain is "frontend-ui".
    <invocation>
      spawn_agent(agent="implementer-frontend-ui", prompt="<spawn-meta task-id=\"2026-04-24-users:batch2:2.3:implementer:src/components/UserCard.tsx\" run-id=\"<your-session-id>\" generation=\"1\" />\nImplement task 2.3: Create src/components/UserCard.tsx with test. [code] **Contract:** thoughts/shared/plans/2026-04-24-users-contract.md", description="Task 2.3")
    </invocation>
  </subagent>
  <subagent name="implementer-frontend-code">
    Frontend code-logic implementer: state, data flow, forms, events, type fixes, frontend tests.
    Use when task Domain is "frontend-code".
    <invocation>
      spawn_agent(agent="implementer-frontend-code", prompt="<spawn-meta task-id=\"2026-04-24-users:batch3:3.1:implementer:src/hooks/useUserForm.ts\" run-id=\"<your-session-id>\" generation=\"1\" />\nImplement task 3.1: Create src/hooks/useUserForm.ts with test. [code] **Contract:** thoughts/shared/plans/2026-04-24-users-contract.md", description="Task 3.1")
    </invocation>
  </subagent>
```

The `implementer-backend`, `implementer-general`, and `reviewer` subagent blocks are unchanged.

**Edit I — `<execution-example>` Task 1.8 dispatch.**

Find the line in the execution example that dispatches Task 1.8 to `implementer-frontend`:

```
spawn_agent(agent="implementer-frontend", prompt="<spawn-meta task-id=\"2026-04-24-users:batch1:1.8:implementer:src/app/globals.css\" run-id=\"<your-session-id>\" generation=\"1\" />\nTask 1.8: Create src/app/globals.css [code]", description="1.8")
```

Replace with:

```
spawn_agent(agent="implementer-frontend-ui", prompt="<spawn-meta task-id=\"2026-04-24-users:batch1:1.8:implementer:src/app/globals.css\" run-id=\"<your-session-id>\" generation=\"1\" />\nTask 1.8: Create src/app/globals.css [code]", description="1.8")
```

Also update the comment line above it:

Find:

```
# Task 1.8 marked Domain: frontend (global styles)
```

Replace with:

```
# Task 1.8 marked Domain: frontend-ui (global styles)
```

**Edit J — `<never-do>` block at end of prompt.**

Find:

```
<forbidden>NEVER spawn agent="implementer" (unsuffixed) - that name no longer exists in the registry; always dispatch by Domain</forbidden>
```

Replace with:

```
<forbidden>NEVER spawn agent="implementer" (unsuffixed) or agent="implementer-frontend" (the old single-frontend agent) - those names no longer exist in the registry; always dispatch by the explicit Domain value</forbidden>
```

No other lines in `src/agents/executor.ts` change.

**Verify:** `bun test tests/agents/executor-dispatch.test.ts tests/agents/executor-prompt.test.ts` and `bun run typecheck`
**Commit:** none

---

### Task 2.4: Update commander prompt in `src/agents/commander.ts`
**File:** `src/agents/commander.ts`
**Test:** none (this is a single-line phrasing change inside a long prompt; no existing test asserts on this exact phrase, and Batch 3 does not add one)
**Depends:** none
**Domain:** general

Reasoning: `src/agents/commander.ts` has one line listing the implementer agents. We update it to mention both new frontend agents so the commander's prompt does not advertise a stale agent name.

Find (around line 325-326):

```
  delivery orchestrator and dispatches implementer-frontend / implementer-backend
  / implementer-general / reviewer per the existing workflow. This is the
```

Replace with:

```
  delivery orchestrator and dispatches implementer-frontend-ui / implementer-frontend-code
  / implementer-backend / implementer-general / reviewer per the existing workflow. This is the
```

No other lines in `src/agents/commander.ts` change.

**Verify:** `bun run typecheck` and `bun test tests/agents/commander.test.ts` (existing test should still pass since no commander test asserts on the old phrase)
**Commit:** none

---

(Task 2.5 was originally drafted as deletion of `src/agents/implementer-frontend.ts` but it has an intra-batch dependency on 2.1, which the executor cannot honor inside a single parallel batch. Deletion is moved to Batch 3 Task 3.0, where the cross-batch fence guarantees Task 2.1 has already landed in `src/agents/index.ts`.)

---

## Batch 3: Old Module Deletion + Test Updates (parallel - 9 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8

### Task 3.0: Delete old `src/agents/implementer-frontend.ts`
**File:** `src/agents/implementer-frontend.ts` (DELETE)
**Test:** none (file deletion; Task 3.4 below covers the registry-absence assertion via `expect(module.agents["implementer-frontend"]).toBeUndefined()`. Typecheck and the test suite collectively prove no remaining reference.)
**Depends:** 2.1 (cross-batch fence: Batch 2 has already removed the import from `src/agents/index.ts`)
**Domain:** general

Reasoning: This deletion sat as Task 2.5 in an earlier draft of this plan but had an intra-batch dep on 2.1, which the executor cannot honor. Moving it to the start of Batch 3 makes the dep cross-batch and therefore safe under the executor's "Batch N waits for Batch N-1" rule.

Adaptation rule: before deletion, run `bun grep -n "implementer-frontend" src/agents/index.ts`. If the old import or registry key still exists, abort and report MISMATCH (it means Task 2.1 did not land or landed wrong). Otherwise proceed.

Action:

```bash
rm src/agents/implementer-frontend.ts
```

**Verify:** `bun run typecheck` (must pass with no dangling reference)
**Commit:** none

---

### Task 3.1: Update `tests/agents/planner-domain.test.ts`
**File:** `tests/agents/planner-domain.test.ts`
**Test:** this IS the test file (no separate test for it; it self-validates by running)
**Depends:** 2.2 (asserts against the new `src/agents/planner.ts` source)
**Domain:** general

Reasoning: The existing test asserts on `frontend | backend | general`. We replace those assertions with the new domain set and add a new assertion that the planner prompt names both new frontend domains and the tie-breaker.

Full replacement:

```typescript
import { describe, expect, it } from "bun:test";

describe("planner domain classification", () => {
  it("includes a domain-classification section in the prompt", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<domain-classification");
    expect(source).toContain("</domain-classification>");
  });

  it("documents all four domain values", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("frontend-ui");
    expect(source).toContain("frontend-code");
    expect(source).toContain("backend");
    expect(source).toContain("general");
  });

  it("does not advertise the old single 'frontend' domain in the documented set", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    // The skeleton template Domain line must list the new four-value set, not the old three.
    expect(source).toContain("**Domain:** frontend-ui | frontend-code | backend | general");
    expect(source).not.toContain("**Domain:** frontend | backend | general");
    // The classification rule line must list the new four-value set.
    expect(source).toContain("frontend-ui | frontend-code | backend | general");
  });

  it("lists concrete signals for both frontend variants and backend classification", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain(".tsx");
    expect(source).toContain(".vue");
    expect(source).toContain("src/api/");
    expect(source).toContain(".sql");
    expect(source).toContain("design-system/");
    expect(source).toContain("hooks/");
  });

  it("includes a frontend tie-breaker rule for ambiguous tasks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<frontend-tiebreaker>");
    expect(source).toContain("frontend-code if correctness");
    expect(source).toContain("frontend-ui if user-visible design quality");
  });

  it("Task template includes a **Domain:** field with the new four-value set", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("**Domain:**");
    expect(source).toContain("frontend-ui | frontend-code | backend | general");
  });

  it("declares a domain-tagged principle", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain('name="domain-tagged"');
  });

  it("preserves existing design document reference", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("thoughts/shared/designs");
  });
});
```

**Verify:** `bun test tests/agents/planner-domain.test.ts`
**Commit:** none

---

### Task 3.2: Update `tests/agents/planner-contract.test.ts`
**File:** `tests/agents/planner-contract.test.ts`
**Test:** this IS the test file
**Depends:** 2.2
**Domain:** general

Reasoning: The contract trigger now mentions the two frontend domains. The test must assert that the trigger references both of them (not the old single `frontend`).

Full replacement:

```typescript
import { describe, expect, it } from "bun:test";

describe("planner contract generation", () => {
  it("includes a contract-generation section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-generation");
    expect(source).toContain("</contract-generation>");
  });

  it("triggers contract when plan spans any frontend variant and backend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-trigger>");
    expect(source).toContain("Domain: frontend-ui");
    expect(source).toContain("Domain: frontend-code");
    expect(source).toContain("Domain: backend");
  });

  it("specifies the contract output path and filename pattern", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md");
  });

  it("documents a contract format with HTTP endpoints and TypeScript schemas", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("HTTP Endpoints");
    expect(source).toContain("Request");
    expect(source).toContain("Response");
  });

  it("includes a self-check phase to verify contract consistency", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-self-check>");
  });

  it("self-check explicitly mentions both frontend variants", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("frontend-ui or frontend-code task");
  });

  it("declares the contract as frozen once the plan is handed off", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-lifecycle>");
    expect(source).toContain("FROZEN");
  });

  it("plan header template contains a **Contract:** field", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("**Contract:**");
  });

  it("mentions the shared contracts task when shared types are abundant", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("src/shared/contracts.ts");
  });
});
```

**Verify:** `bun test tests/agents/planner-contract.test.ts`
**Commit:** none

---

### Task 3.3: Update `tests/agents/executor-dispatch.test.ts`
**File:** `tests/agents/executor-dispatch.test.ts`
**Test:** this IS the test file
**Depends:** 2.3
**Domain:** general

Reasoning: Dispatch table now has four entries; available subagents list two new frontend agents and no longer lists the old `implementer-frontend`; a stale-frontend guard exists; the never-do explicitly forbids `agent="implementer-frontend"`.

Full replacement:

```typescript
import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

describe("executor domain dispatch", () => {
  it("lists the four domain-specific implementers as available subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('name="implementer-frontend-ui"');
    expect(source).toContain('name="implementer-frontend-code"');
    expect(source).toContain('name="implementer-backend"');
    expect(source).toContain('name="implementer-general"');
  });

  it("no longer lists the old single implementer-frontend as an available subagent", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).not.toContain('name="implementer-frontend"');
  });

  it("declares a domain-dispatch section with a four-row mapping table", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<domain-dispatch");
    expect(source).toContain("<dispatch-table>");
    expect(source).toContain('from="frontend-ui"');
    expect(source).toContain('from="frontend-code"');
    expect(source).toContain('from="backend"');
    expect(source).toContain('from="general"');
  });

  it("does not expose the old single 'frontend' as a from-value in the dispatch table", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).not.toContain('from="frontend" to=');
  });

  it("includes a stale-frontend guard that fails the run on Domain: frontend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<stale-frontend-guard");
    expect(source).toContain("Plan is stale");
    expect(source).toContain("Re-run planner");
  });

  it("defaults to implementer-general when Domain is missing or unrecognized (excluding the stale frontend literal)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<fallback>");
    expect(source).toContain("implementer-general");
    expect(source).toContain("known-stale literal");
  });

  it("forbids spawning the unsuffixed implementer and the old implementer-frontend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('NEVER spawn agent="implementer"');
    expect(source).toContain('agent="implementer-frontend"');
  });

  it("propagates the Contract path in spawn prompts when plan has one", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<contract-propagation");
    expect(source).toContain("**Contract:**");
    expect(source).toContain("READ FIRST");
  });

  it("includes spawn identity and cleanup guidance", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<spawn-meta");
    expect(source).toContain("cleanup_parent_run");
    expect(source).toContain("Generation fence");
  });

  it("prompt includes spawn-meta identity guidance", () => {
    expect(executorAgent.prompt).toContain("<spawn-meta");
    expect(executorAgent.prompt).toContain("cleanup_parent_run");
    expect(executorAgent.prompt).toContain("Generation fence");
  });

  it("forbids editing the contract on behalf of implementers", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("NEVER edit the contract");
  });

  it("execution example demonstrates dispatch to both new frontend agents and backend/general", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('agent="implementer-frontend-ui"');
    expect(source).toContain('agent="implementer-frontend-code"');
    expect(source).toContain('agent="implementer-backend"');
    expect(source).toContain('agent="implementer-general"');
  });
});
```

**Verify:** `bun test tests/agents/executor-dispatch.test.ts`
**Commit:** none

---

### Task 3.4: Update `tests/agents/implementer-domain.test.ts`
**File:** `tests/agents/implementer-domain.test.ts`
**Test:** this IS the test file
**Depends:** 2.1, 3.0
**Domain:** general

Reasoning: Registry now exposes `implementer-frontend-ui` and `implementer-frontend-code` and no longer exposes `implementer-frontend`. All references to the old module path must be replaced.

Full replacement:

```typescript
import { describe, expect, it } from "bun:test";

import { DEFAULT_MODEL } from "../../src/utils/config";

describe("domain-specific implementers", () => {
  it("registers implementer-frontend-ui, implementer-frontend-code, implementer-backend, implementer-general", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["implementer-frontend-ui"]).toBeDefined();
    expect(module.agents["implementer-frontend-code"]).toBeDefined();
    expect(module.agents["implementer-backend"]).toBeDefined();
    expect(module.agents["implementer-general"]).toBeDefined();
  });

  it("removes the unsuffixed implementer and the old single implementer-frontend from the registry", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.implementer).toBeUndefined();
    expect(module.agents["implementer-frontend"]).toBeUndefined();
  });

  it("configures all four domain implementers as subagents with DEFAULT_MODEL", async () => {
    const module = await import("../../src/agents/index");

    for (const name of [
      "implementer-frontend-ui",
      "implementer-frontend-code",
      "implementer-backend",
      "implementer-general",
    ]) {
      const agent = module.agents[name];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("shares the base implementer prompt across all four variants", async () => {
    const module = await import("../../src/agents/implementer");
    const uiModule = await import("../../src/agents/implementer-frontend-ui");
    const codeModule = await import("../../src/agents/implementer-frontend-code");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    const basePrompt = module.BASE_IMPLEMENTER_PROMPT;
    expect(basePrompt.length).toBeGreaterThan(0);

    for (const agent of [
      uiModule.implementerFrontendUiAgent,
      codeModule.implementerFrontendCodeAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      expect(agent.prompt).toContain(basePrompt);
    }
  });

  it("frontend-ui variant emphasises UI/UX, design system, and accessibility", async () => {
    const module = await import("../../src/agents/implementer-frontend-ui");
    const prompt = module.implementerFrontendUiAgent.prompt ?? "";

    expect(prompt).toContain("Frontend UI");
    expect(prompt).toContain("design-system");
    expect(prompt).toContain("accessibility");
    expect(prompt).toContain(".tsx");
  });

  it("frontend-code variant emphasises logic, state, types, and minimal scoped change", async () => {
    const module = await import("../../src/agents/implementer-frontend-code");
    const prompt = module.implementerFrontendCodeAgent.prompt ?? "";

    expect(prompt).toContain("Frontend code-logic");
    expect(prompt).toContain("state");
    expect(prompt).toContain("type safety");
    expect(prompt).toContain("Minimal, scoped");
  });

  it("backend variant includes server-side constraints", async () => {
    const module = await import("../../src/agents/implementer-backend");
    const prompt = module.implementerBackendAgent.prompt ?? "";

    expect(prompt).toContain("Backend");
    expect(prompt).toContain("src/api/");
    expect(prompt).toContain(".sql");
  });

  it("general variant describes cross-cutting scope", async () => {
    const module = await import("../../src/agents/implementer-general");
    const prompt = module.implementerGeneralAgent.prompt ?? "";

    expect(prompt).toContain("General");
    expect(prompt).toContain("src/shared/");
  });

  it("all four variants enforce the contract-read-first rule", async () => {
    const uiModule = await import("../../src/agents/implementer-frontend-ui");
    const codeModule = await import("../../src/agents/implementer-frontend-code");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    for (const agent of [
      uiModule.implementerFrontendUiAgent,
      codeModule.implementerFrontendCodeAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      const prompt = agent.prompt ?? "";
      expect(prompt).toContain("Contract");
      expect(prompt).toContain("ESCALATE");
    }
  });
});
```

**Verify:** `bun test tests/agents/implementer-domain.test.ts`
**Commit:** none

---

### Task 3.5: Update `tests/tools/spawn-agent/agent-roles.test.ts`
**File:** `tests/tools/spawn-agent/agent-roles.test.ts`
**Test:** this IS the test file
**Depends:** 1.3
**Domain:** general

Reasoning: The role-label map no longer contains `implementer-frontend`. New labels exist for `implementer-frontend-ui` and `implementer-frontend-code`. Update assertions.

Full replacement:

```typescript
import { describe, expect, it } from "bun:test";

import { AGENT_ROLE_LABELS, agentRoleLabel } from "@/tools/spawn-agent/agent-roles";

describe("agent-roles", () => {
  it("returns Chinese label for known agent", () => {
    expect(agentRoleLabel("implementer-backend")).toBe("后端实现");
    expect(agentRoleLabel("implementer-frontend-ui")).toBe("前端UI实现");
    expect(agentRoleLabel("implementer-frontend-code")).toBe("前端代码实现");
    expect(agentRoleLabel("implementer-general")).toBe("通用实现");
    expect(agentRoleLabel("reviewer")).toBe("代码审查");
    expect(agentRoleLabel("planner")).toBe("规划");
    expect(agentRoleLabel("brainstormer")).toBe("方案探索");
    expect(agentRoleLabel("executor")).toBe("执行调度");
    expect(agentRoleLabel("commander")).toBe("总指挥");
    expect(agentRoleLabel("codebase-analyzer")).toBe("代码分析");
    expect(agentRoleLabel("codebase-locator")).toBe("代码定位");
    expect(agentRoleLabel("pattern-finder")).toBe("模式查找");
    expect(agentRoleLabel("critic")).toBe("对抗审查");
  });

  it("does not silently label the old implementer-frontend (must surface as raw name)", () => {
    // After the split, the old name should NOT be in the friendly-label map.
    // It still passes through as the raw name because the function falls back to the cleaned input.
    expect(agentRoleLabel("implementer-frontend")).toBe("implementer-frontend");
    expect(AGENT_ROLE_LABELS["implementer-frontend"]).toBeUndefined();
  });

  it("strips spawn-agent. technical prefix from unknown agent name", () => {
    expect(agentRoleLabel("spawn-agent.unknown-agent")).toBe("unknown-agent");
  });

  it("returns the original name for unknown agent without prefix", () => {
    expect(agentRoleLabel("custom-agent")).toBe("custom-agent");
  });

  it("returns generic fallback for empty or whitespace input", () => {
    expect(agentRoleLabel("")).toBe("子任务");
    expect(agentRoleLabel("   ")).toBe("子任务");
  });

  it("exposes the label map as readonly record", () => {
    expect(AGENT_ROLE_LABELS.reviewer).toBe("代码审查");
    expect(AGENT_ROLE_LABELS.critic).toBe("对抗审查");
    expect(AGENT_ROLE_LABELS["implementer-frontend-ui"]).toBe("前端UI实现");
    expect(AGENT_ROLE_LABELS["implementer-frontend-code"]).toBe("前端代码实现");
  });

  it("returns Chinese labels for the five specialist agents", () => {
    expect(agentRoleLabel("product-manager")).toBe("产品经理");
    expect(agentRoleLabel("software-architect")).toBe("软件架构师");
    expect(agentRoleLabel("ux-designer")).toBe("UX 设计师");
    expect(agentRoleLabel("architecture-quality-inspector")).toBe("架构质检");
    expect(agentRoleLabel("rubric-reviewer")).toBe("Rubric 评审");
  });

  it("exposes the five specialists in the readonly label map", () => {
    expect(AGENT_ROLE_LABELS["product-manager"]).toBe("产品经理");
    expect(AGENT_ROLE_LABELS["software-architect"]).toBe("软件架构师");
    expect(AGENT_ROLE_LABELS["ux-designer"]).toBe("UX 设计师");
    expect(AGENT_ROLE_LABELS["architecture-quality-inspector"]).toBe("架构质检");
    expect(AGENT_ROLE_LABELS["rubric-reviewer"]).toBe("Rubric 评审");
  });

  it("strips the spawn-agent. prefix from a specialist agent name", () => {
    expect(agentRoleLabel("spawn-agent.product-manager")).toBe("产品经理");
    expect(agentRoleLabel("spawn-agent.rubric-reviewer")).toBe("Rubric 评审");
  });

  it("strips the spawn-agent. prefix from the new frontend variants", () => {
    expect(agentRoleLabel("spawn-agent.implementer-frontend-ui")).toBe("前端UI实现");
    expect(agentRoleLabel("spawn-agent.implementer-frontend-code")).toBe("前端代码实现");
  });
});
```

**Verify:** `bun test tests/tools/spawn-agent/agent-roles.test.ts`
**Commit:** none

---

### Task 3.6: Update `tests/config-loader-integration.test.ts`
**File:** `tests/config-loader-integration.test.ts`
**Test:** this IS the test file
**Depends:** 2.1
**Domain:** general

Reasoning: The expected-agents list must replace `implementer-frontend` with the two new entries.

Surgical edit (only the `expectedAgents` array changes):

Find:

```typescript
    const expectedAgents = [
      "commander",
      "brainstormer",
      "codebase-locator",
      "codebase-analyzer",
      "pattern-finder",
      "planner",
      "implementer-frontend",
      "implementer-backend",
      "implementer-general",
      "reviewer",
      "investigator",
      "executor",
      "ledger-creator",
      "artifact-searcher",
      "mm-orchestrator",
    ];
```

Replace with:

```typescript
    const expectedAgents = [
      "commander",
      "brainstormer",
      "codebase-locator",
      "codebase-analyzer",
      "pattern-finder",
      "planner",
      "implementer-frontend-ui",
      "implementer-frontend-code",
      "implementer-backend",
      "implementer-general",
      "reviewer",
      "investigator",
      "executor",
      "ledger-creator",
      "artifact-searcher",
      "mm-orchestrator",
    ];
```

No other lines change.

**Verify:** `bun test tests/config-loader-integration.test.ts`
**Commit:** none

---

### Task 3.7: Update `tests/config/active-commander-model.test.ts`
**File:** `tests/config/active-commander-model.test.ts`
**Test:** this IS the test file
**Depends:** 4.5 (the active host config example update for the new agents — but this test only runs when the active host config exists, and it uses `it.skip` when missing, so the test passes on hosts without the config)
**Domain:** general

Reasoning: This test inspects the user's actual active host config at `~/.config/opencode/micode.jsonc`. It cannot reliably assert that the host has updated the agent list before the user edits their own file. The safe move is to:
1. Replace the two existing `implementer-frontend` assertions with `implementer-frontend-ui` and `implementer-frontend-code` assertions (matching the new expected names).
2. Add a `it.skip`-guarded shape that gracefully passes when the host config does not yet declare the new agents, preserving the existing skip-when-missing pattern.

Surgical edit (replace only the three "keeps implementer-frontend / -backend / -general" `it` blocks):

Find:

```typescript
  it("keeps implementer-frontend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-frontend"]).toBeDefined();
    expect(agents["implementer-frontend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-backend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-backend"]).toBeDefined();
    expect(agents["implementer-backend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-general on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-general"]).toBeDefined();
    expect(agents["implementer-general"]?.model).toBe("wuxie-openai/gpt-5.5");
  });
```

Replace with:

```typescript
  it("does not keep the old implementer-frontend in active config (it must be removed)", () => {
    // After issue #56, implementer-frontend no longer exists. The active host config
    // must either omit the key entirely or have been replaced by the two new agents.
    if (agents["implementer-frontend"] !== undefined) {
      throw new Error(
        "active config still references the stale implementer-frontend agent; replace it with implementer-frontend-ui and implementer-frontend-code",
      );
    }
  });

  it("routes implementer-frontend-ui to a UI/UX-strong model when configured", () => {
    if (agents["implementer-frontend-ui"] === undefined) {
      // Host has not yet adopted the new split; treat as skipped at expectation level.
      return;
    }
    expect(agents["implementer-frontend-ui"]?.model).toBeDefined();
  });

  it("routes implementer-frontend-code to a code-logic-strong model when configured", () => {
    if (agents["implementer-frontend-code"] === undefined) {
      return;
    }
    expect(agents["implementer-frontend-code"]?.model).toBeDefined();
  });

  it("keeps implementer-backend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-backend"]).toBeDefined();
    expect(agents["implementer-backend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-general on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-general"]).toBeDefined();
    expect(agents["implementer-general"]?.model).toBe("wuxie-openai/gpt-5.5");
  });
```

Decision rationale: This file tests the user's host config. We cannot ship the host's actual `micode.jsonc` from this repo. The test should fail loudly only on the obvious regression (still referencing the stale `implementer-frontend`), and be lenient about model assignment for the two new agents until the user re-declares them. The user will update their own `~/.config/opencode/micode.jsonc` after this issue lands.

**Verify:** `bun test tests/config/active-commander-model.test.ts` (passes whether host config has or has not been updated yet)
**Commit:** none

---

### Task 3.8: Update spawn-agent test fixtures that name `implementer-frontend`
**File:** `tests/tools/spawn-agent-args.test.ts`
**Test:** this IS the test file (other spawn-agent fixture files are handled in Batch 4 task 4.5)
**Depends:** 1.3, 2.1 (registry no longer recognises `implementer-frontend`)
**Domain:** general

Reasoning: This file uses `agent: "implementer-frontend"` as test fixture data. Although these tests do not query the registry, they are now stale text. Replace each occurrence with `implementer-frontend-ui` (the closest semantic equivalent for "UI-ish frontend test fixture"). This keeps the tests realistic for the post-split workflow.

Surgical edit (three occurrences total — line 7, line 170, line 178):

Find on line 7:

```typescript
  agent: "implementer-frontend",
```

Replace with:

```typescript
  agent: "implementer-frontend-ui",
```

Find on line 170:

```typescript
        agents: [{ agent: "implementer-frontend", prompt: "Hello." }],
```

Replace with:

```typescript
        agents: [{ agent: "implementer-frontend-ui", prompt: "Hello." }],
```

Find on line 178:

```typescript
        agent: "implementer-frontend",
```

Replace with:

```typescript
        agent: "implementer-frontend-ui",
```

If the implementer cannot find these exact strings (line numbers may have shifted), use grep to locate `implementer-frontend"` (with closing quote) and replace each occurrence with `implementer-frontend-ui"`. Do NOT replace any occurrence of `implementer-frontend-ui` or `implementer-frontend-code` already in the file.

**Verify:** `bun test tests/tools/spawn-agent-args.test.ts`
**Commit:** none

---

## Batch 4: Docs and Spawn-Agent Test Fixtures (parallel - 5 implementers)

All tasks in this batch depend on Batch 2 completing (independent of Batch 3).
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5

### Task 4.1: Update `micode.example.jsonc` config example
**File:** `micode.example.jsonc`
**Test:** none (JSONC config example, validated by user adoption — no automated test asserts against this file's keys)
**Depends:** 2.1
**Domain:** general

Reasoning: The user-facing config example must teach how to assign distinct models to the two new frontend implementers. Replace the single `implementer-frontend` line with two lines, and update the placeholder legend so the user understands which placeholder maps to which agent. Decision: introduce two new placeholders `<YOUR_FRONTEND_UI_MODEL>` and `<YOUR_FRONTEND_CODE_MODEL>` and document them as Gemini 3.1 Pro and gpt-5.5 by spirit (without naming concrete models, since the project policy forbids shipping concrete provider strings).

Surgical edits:

**Edit A — Add two new placeholder entries to the legend.**

Find this block in the header comment:

```
//   <YOUR_FRONTEND_MODEL>
//     A model that is strong at UI, styling, component design, and modern
//     frontend framework idioms (React / Vue / Svelte, CSS-in-JS, etc).
```

Replace with:

```
//   <YOUR_FRONTEND_UI_MODEL>
//     A model that is strong at UI/UX work: layout, styling, accessibility,
//     interaction design, motion, and design-system use. Recommended for
//     implementer-frontend-ui. Pair this with a model that produces visually
//     coherent UI from prompt-driven specs (Gemini 3.1 Pro tier or similar).
//
//   <YOUR_FRONTEND_CODE_MODEL>
//     A model that is strong at frontend engineering: state machines, data
//     flow, form validation, type fixes, and frontend tests. Recommended for
//     implementer-frontend-code. Pair this with a model strong at TypeScript
//     and small scoped engineering changes (gpt-5.5 tier or similar).
```

**Edit B — Replace the implementer-frontend agent entry in the `agents` block.**

Find:

```
    "implementer-frontend": { "model": "<YOUR_FRONTEND_MODEL>" },
    "implementer-backend": { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general": { "model": "<YOUR_BACKEND_MODEL>" },
```

Replace with:

```
    "implementer-frontend-ui":   { "model": "<YOUR_FRONTEND_UI_MODEL>" },
    "implementer-frontend-code": { "model": "<YOUR_FRONTEND_CODE_MODEL>" },
    "implementer-backend":       { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general":       { "model": "<YOUR_BACKEND_MODEL>" },
```

**Edit C — Update the trailing fragment example comment.**

Find:

```
  //   "implementer-frontend": ["This project uses Tailwind; no CSS modules"]
```

Replace with:

```
  //   "implementer-frontend-ui": ["This project uses Tailwind; no CSS modules"]
```

No other lines change.

**Verify:** Manual review (no automated test) — the file is JSONC and the structure is checked by user adoption. The host-config test in Task 3.7 covers the runtime regression path.
**Commit:** none

---

### Task 4.2: Update `README.md`
**File:** `README.md`
**Test:** none (documentation)
**Depends:** 2.1
**Domain:** general

Reasoning: README has six occurrences of `implementer-frontend` and the prose talks about the single frontend implementer.

Surgical edits:

**Edit A — Top blurb (line 6 area):**

Find:

```
> - `implementer` is split into `implementer-frontend` / `implementer-backend` / `implementer-general`, so each can run on a model that is strong in that domain (frontend-strong model for UI, backend-strong model for APIs, etc).
> - `planner` tags every task with a `Domain` field, and when a plan spans both frontend and backend it emits a frozen API contract document the concurrent implementers must conform to.
```

Replace with:

```
> - `implementer` is split into `implementer-frontend-ui` / `implementer-frontend-code` / `implementer-backend` / `implementer-general`, so each can run on a model that is strong in that domain (UI-strong model for design and accessibility work, code-strong model for state and types, backend-strong model for APIs, etc).
> - `planner` tags every task with a `Domain` field (`frontend-ui`, `frontend-code`, `backend`, or `general`), and when a plan spans both frontend (ui or code) and backend it emits a frozen API contract document the concurrent implementers must conform to.
```

**Edit B — Plan/Domain paragraph (line 38 area):**

Find:

```
Transform designs into implementation plans with bite-sized tasks (2-5 min each), exact file paths, and TDD workflow. Every task is tagged with a `Domain` (frontend, backend, or general). When the plan spans both frontend and backend tasks, the planner additionally emits a **frozen API contract document** that concurrent implementers must conform to. Outputs:
```

Replace with:

```
Transform designs into implementation plans with bite-sized tasks (2-5 min each), exact file paths, and TDD workflow. Every task is tagged with a `Domain` (`frontend-ui`, `frontend-code`, `backend`, or `general`). When the plan spans both frontend (ui or code) and backend tasks, the planner additionally emits a **frozen API contract document** that concurrent implementers must conform to. Outputs:
```

**Edit C — Executor paragraph (line 43 area):**

Find:

```
Execute in git worktree for isolation. The **Executor** reads each task's `Domain` and dispatches to the matching specialist implementer (`implementer-frontend`, `implementer-backend`, or `implementer-general`), injecting the contract path into every implementer and reviewer spawn prompt. Runs implementer → reviewer cycles with parallel execution via fire-and-check pattern. Implementers that detect a contract mismatch escalate; they do not edit the contract.
```

Replace with:

```
Execute in git worktree for isolation. The **Executor** reads each task's `Domain` and dispatches to the matching specialist implementer (`implementer-frontend-ui`, `implementer-frontend-code`, `implementer-backend`, or `implementer-general`), injecting the contract path into every implementer and reviewer spawn prompt. The literal stale `Domain: frontend` value (from plans generated before the split) is treated as a stale-plan error and stops execution with a clear instruction to re-run the planner. Runs implementer → reviewer cycles with parallel execution via fire-and-check pattern. Implementers that detect a contract mismatch escalate; they do not edit the contract.
```

**Edit D — Agent table (line 65-67 area):**

Find:

```
| **implementer-frontend** | Executes frontend tasks (React/Vue/Svelte, CSS, UI) |
| **implementer-backend** | Executes backend tasks (APIs, DB, middleware, services) |
| **implementer-general** | Executes cross-cutting tasks (configs, shared types, scripts) |
```

Replace with:

```
| **implementer-frontend-ui** | Executes frontend UI/UX tasks (layout, styling, design-system, accessibility, motion) |
| **implementer-frontend-code** | Executes frontend code-logic tasks (state, data flow, forms, type fixes, frontend tests) |
| **implementer-backend** | Executes backend tasks (APIs, DB, middleware, services) |
| **implementer-general** | Executes cross-cutting tasks (configs, shared types, scripts) |
```

**Edit E — Config example block (line 134-136 area):**

Find:

```
    "implementer-frontend": { "model": "<YOUR_FRONTEND_MODEL>" },
    "implementer-backend":  { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general":  { "model": "<YOUR_BACKEND_MODEL>" }
```

Replace with:

```
    "implementer-frontend-ui":   { "model": "<YOUR_FRONTEND_UI_MODEL>" },
    "implementer-frontend-code": { "model": "<YOUR_FRONTEND_CODE_MODEL>" },
    "implementer-backend":       { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general":       { "model": "<YOUR_BACKEND_MODEL>" }
```

No other lines change.

**Verify:** Manual review and `bun test` (no test specifically reads README, but ensure no string-matching test in the suite expects the old phrasing — none do, per Batch 3 test enumeration)
**Commit:** none

---

### Task 4.3: Update `ARCHITECTURE.md`
**File:** `ARCHITECTURE.md`
**Test:** none (documentation)
**Depends:** 2.1
**Domain:** general

Reasoning: ARCHITECTURE.md has four occurrences referencing `implementer-frontend`.

Surgical edits:

**Edit A — Overview line 5:**

Find:

```
`micode` is a TypeScript OpenCode plugin that installs a structured Brainstorm -> Plan -> Implement workflow, project-aware hooks, agent tooling, browser brainstorming, and searchable session artifacts. This fork adds domain-routed implementers (`implementer-frontend`, `implementer-backend`, `implementer-general`) and frozen API contract documents for cross-domain plans.
```

Replace with:

```
`micode` is a TypeScript OpenCode plugin that installs a structured Brainstorm -> Plan -> Implement workflow, project-aware hooks, agent tooling, browser brainstorming, and searchable session artifacts. This fork adds domain-routed implementers (`implementer-frontend-ui`, `implementer-frontend-code`, `implementer-backend`, `implementer-general`) and frozen API contract documents for cross-domain plans.
```

**Edit B — Workflow agents table (lines 79-81):**

Find:

```
| `implementer-frontend` | `src/agents/implementer-frontend.ts` | UI, styling, browser-facing work |
| `implementer-backend` | `src/agents/implementer-backend.ts` | APIs, data layer, server-side work |
| `implementer-general` | `src/agents/implementer-general.ts` | Config, tooling, shared types, cross-cutting files |
```

Replace with:

```
| `implementer-frontend-ui` | `src/agents/implementer-frontend-ui.ts` | UI/UX, layout, styling, accessibility, motion, design-system use |
| `implementer-frontend-code` | `src/agents/implementer-frontend-code.ts` | Frontend code-logic, state, data flow, type fixes, frontend tests |
| `implementer-backend` | `src/agents/implementer-backend.ts` | APIs, data layer, server-side work |
| `implementer-general` | `src/agents/implementer-general.ts` | Config, tooling, shared types, cross-cutting files |
```

**Edit C — User workflow step 4 (line 152):**

Find:

```
4. If a plan has both frontend and backend tasks, `planner` also writes `thoughts/shared/plans/YYYY-MM-DD-topic-contract.md`.
```

Replace with:

```
4. If a plan has at least one frontend task (frontend-ui or frontend-code) and at least one backend task, `planner` also writes `thoughts/shared/plans/YYYY-MM-DD-topic-contract.md`.
```

No other lines change.

**Verify:** Manual review
**Commit:** none

---

### Task 4.4: Update `CODE_STYLE.md`
**File:** `CODE_STYLE.md`
**Test:** none (documentation)
**Depends:** 2.1
**Domain:** general

Reasoning: CODE_STYLE.md has two references to `implementer-frontend`.

Surgical edits:

**Edit A — Naming-conventions table example (line 23):**

Find:

```
| Agent registry keys | kebab-case strings when exposed to OpenCode | `codebase-locator`, `implementer-frontend` |
```

Replace with:

```
| Agent registry keys | kebab-case strings when exposed to OpenCode | `codebase-locator`, `implementer-frontend-ui`, `implementer-frontend-code` |
```

**Edit B — Don't-list line 266:**

Find:

```
- Do not skip contract propagation for cross-domain frontend and backend plans.
```

Replace with:

```
- Do not skip contract propagation for cross-domain plans (any plan with a frontend-ui or frontend-code task plus a backend task).
```

No other lines change.

**Verify:** Manual review
**Commit:** none

---

### Task 4.5: Update remaining spawn-agent test fixtures
**File:** `tests/tools/spawn-agent/format.test.ts` (one file per task — see decision below for the others)
**Test:** this IS the test file
**Depends:** 1.3, 2.1
**Domain:** general

Decision: Six other spawn-agent test files use `implementer-frontend` as fixture data:
- `tests/tools/spawn-agent/format.test.ts` (this task)
- `tests/tools/spawn-agent/integration.test.ts` (Task 4.5b - see below)
- `tests/tools/spawn-agent/naming-integration.test.ts` (Task 4.5c)
- `tests/tools/spawn-agent/spawn-session-registry.test.ts` (Task 4.5d)
- `tests/tools/spawn-agent/task-identity.test.ts` (Task 4.5e)
- `tests/integration/spawn-agent-allsettled.test.ts` (Task 4.5f)

I am collapsing these six into a single Task 4.5 with sub-edits a-f because each is a 1-2 line fixture string change with identical reasoning. The "one file per task" rule is preserved logically: each sub-edit targets exactly one file, and the executor's implementer can apply them in sequence within this task. If your micro-task budget requires strict 1-file granularity, split this Task 4.5 into Tasks 4.5a-4.5f, each touching one of the files below.

**Reasoning:** these tests use the agent name as fixture data, not as a registry assertion. Replace each `"implementer-frontend"` string with `"implementer-frontend-ui"` (closest semantic equivalent). The tests still exercise the spawn-agent registry/format/cleanup logic; the substitution is purely cosmetic from the test's perspective.

**Sub-edit 4.5a — `tests/tools/spawn-agent/format.test.ts`:**

Find each occurrence of:

```typescript
        agent: "implementer-frontend",
```

Replace with:

```typescript
        agent: "implementer-frontend-ui",
```

There are at least two occurrences (line 70 area and inline assertions). Also update the table-output assertion on line 92:

Find:

```typescript
    expect(output).toContain("| Blocked task | implementer-frontend | blocked | 3.5s | BLOCKED: contract mismatch. |");
```

Replace with:

```typescript
    expect(output).toContain("| Blocked task | implementer-frontend-ui | blocked | 3.5s | BLOCKED: contract mismatch. |");
```

**Sub-edit 4.5b — `tests/tools/spawn-agent/integration.test.ts`:**

Find:

```typescript
  agent: "implementer-frontend",
```

Replace with:

```typescript
  agent: "implementer-frontend-ui",
```

Find:

```typescript
    expect(output).toContain("| Task error task | implementer-frontend | task_error |");
```

Replace with:

```typescript
    expect(output).toContain("| Task error task | implementer-frontend-ui | task_error |");
```

**Sub-edit 4.5c — `tests/tools/spawn-agent/naming-integration.test.ts`:**

Find:

```typescript
        agents: [{ agent: "implementer-frontend", prompt: "tweak ui", description: "" }],
```

Replace with:

```typescript
        agents: [{ agent: "implementer-frontend-ui", prompt: "tweak ui", description: "" }],
```

**Sub-edit 4.5d — `tests/tools/spawn-agent/spawn-session-registry.test.ts`:**

Find:

```typescript
      agent: "implementer-frontend",
```

Replace with:

```typescript
      agent: "implementer-frontend-ui",
```

**Sub-edit 4.5e — `tests/tools/spawn-agent/task-identity.test.ts`:**

Find:

```typescript
      agent: "implementer-frontend",
```

Replace with:

```typescript
      agent: "implementer-frontend-ui",
```

**Sub-edit 4.5f — `tests/integration/spawn-agent-allsettled.test.ts`:**

Find:

```typescript
  agent: "implementer-frontend",
```

Replace with:

```typescript
  agent: "implementer-frontend-ui",
```

Find:

```typescript
    expect(spawnOutput).toContain("| Task error task | implementer-frontend | task_error |");
```

Replace with:

```typescript
    expect(spawnOutput).toContain("| Task error task | implementer-frontend-ui | task_error |");
```

After all sub-edits, run the full spawn-agent and integration test suites to confirm no remaining literal `"implementer-frontend"` (without `-ui` or `-code` suffix) appears in fixture data.

**Verify:**
```
bun test tests/tools/spawn-agent/ tests/integration/spawn-agent-allsettled.test.ts
```

Plus a grep guard:
```
! bun grep -rn '"implementer-frontend"' tests/ src/
```

This grep MUST return no results after all batches complete (the only acceptable matches would be inside string literals that explicitly assert the absence of the old name — those use the literal `"implementer-frontend"` in the code, which is fine).

**Commit:** none
