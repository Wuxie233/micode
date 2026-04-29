---
date: 2026-04-30
topic: "spawn-agent-chinese-session-titles"
issue: 12
scope: spawn-agent
contract: none
---

# Spawn-agent 中文语义化会话标题 Implementation Plan

**Goal:** 为 spawn-agent 创建的内部子会话生成中文语义化标题（含状态、任务摘要、agent 中文角色），并在子会话结束后更新为终态标题，主会话标题策略保持不变。

**Architecture:** 新增 `src/tools/spawn-agent/naming.ts` 命名层，复用 `@/utils/conversation-title/format` 的 `TITLE_STATUS`、`buildTitle`、截断习惯。`tool.ts` 在创建/完成内部 session 时调用 namer，并使用既有 `ctx.client.session.update` 更新终态标题。`internal-session.ts` 暴露已有 update 能力或新增轻量 `updateInternalSession` helper 供 tool 调用。conversation-title hook 不变（继续通过 `isInternalSession` 过滤掉内部会话）。

**Design:** thoughts/shared/designs/2026-04-30-spawn-agent-chinese-session-titles-design.md

**Contract:** none (single-domain `general` — 纯插件内部模块，不跨前后端边界)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - no deps]
  1.1 src/tools/spawn-agent/agent-roles.ts (中文角色映射 + 兜底)
  1.2 src/utils/internal-session.ts 扩展 updateInternalSession (独立于 1.1)
Batch 2 (parallel): 2.1 [naming layer - depends on 1.1]
  2.1 src/tools/spawn-agent/naming.ts (namer：状态+摘要+角色 → 中文标题)
Batch 3 (parallel): 3.1 [tool integration - depends on 1.1, 1.2, 2.1]
  3.1 src/tools/spawn-agent/tool.ts 改为使用 namer + 完成时更新终态标题
Batch 4 (parallel): 4.1 [integration test - depends on 3.1]
  4.1 tests/tools/spawn-agent/naming-integration.test.ts (端到端验证)
```

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Agent role labels (中文角色映射)
**File:** `src/tools/spawn-agent/agent-roles.ts`
**Test:** `tests/tools/spawn-agent/agent-roles.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/tools/spawn-agent/agent-roles.test.ts
import { describe, expect, it } from "bun:test";

import { agentRoleLabel, AGENT_ROLE_LABELS } from "@/tools/spawn-agent/agent-roles";

describe("agent-roles", () => {
  it("returns Chinese label for known agent", () => {
    expect(agentRoleLabel("implementer-backend")).toBe("后端实现");
    expect(agentRoleLabel("implementer-frontend")).toBe("前端实现");
    expect(agentRoleLabel("implementer-general")).toBe("通用实现");
    expect(agentRoleLabel("reviewer")).toBe("代码审查");
    expect(agentRoleLabel("planner")).toBe("规划");
    expect(agentRoleLabel("brainstormer")).toBe("方案探索");
    expect(agentRoleLabel("executor")).toBe("执行调度");
    expect(agentRoleLabel("codebase-analyzer")).toBe("代码分析");
    expect(agentRoleLabel("codebase-locator")).toBe("代码定位");
    expect(agentRoleLabel("pattern-finder")).toBe("模式查找");
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
    expect(AGENT_ROLE_LABELS["reviewer"]).toBe("代码审查");
  });
});
```

```typescript
// src/tools/spawn-agent/agent-roles.ts
const SPAWN_AGENT_PREFIX = "spawn-agent.";
const GENERIC_FALLBACK = "子任务";

export const AGENT_ROLE_LABELS: Readonly<Record<string, string>> = {
  "implementer-backend": "后端实现",
  "implementer-frontend": "前端实现",
  "implementer-general": "通用实现",
  reviewer: "代码审查",
  planner: "规划",
  brainstormer: "方案探索",
  executor: "执行调度",
  commander: "总指挥",
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

**Verify:** `bun test tests/tools/spawn-agent/agent-roles.test.ts`
**Commit:** `feat(spawn-agent): add Chinese agent role label map`

---

### Task 1.2: Extend internal-session helper with updateInternalSession
**File:** `src/utils/internal-session.ts`
**Test:** `tests/utils/internal-session-update.test.ts`
**Depends:** none
**Domain:** general

> Senior engineer's call: design says "complete title update" must call session.update. Rather than letting `tool.ts` reach into `ctx.client.session.update` directly (and duplicate the warn/skip-on-missing logic the existing helpers use), I extend the existing internal-session helper module with a sibling `updateInternalSession`. It mirrors the shape and failure semantics of `deleteInternalSession`: silent no-op when sessionId is null, log-warn (never throw) on transport failure, no retries (single attempt is enough — wrong title is purely cosmetic, while orphan sessions were the reason `deleteInternalSession` retried).

This task ADDS code to the existing file. Append after `deleteInternalSession`. Do not modify any existing exports.

```typescript
// tests/utils/internal-session-update.test.ts
import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { updateInternalSession } from "@/utils/internal-session";

const SESSION_ID = "session_abc";
const DIRECTORY = "/tmp/repo";
const NEW_TITLE = "执行中: 修复后端权限校验";

function createCtx(updateImpl: (req: unknown) => Promise<unknown>): PluginInput {
  return {
    client: { session: { update: updateImpl } },
    directory: DIRECTORY,
  } as never;
}

describe("updateInternalSession", () => {
  it("calls session.update with sessionId and new title", async () => {
    const update = mock(async () => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: SESSION_ID, title: NEW_TITLE });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toEqual({
      path: { id: SESSION_ID },
      body: { title: NEW_TITLE },
      query: { directory: DIRECTORY },
    });
  });

  it("is a no-op when sessionId is null", async () => {
    const update = mock(async () => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: null, title: NEW_TITLE });

    expect(update).not.toHaveBeenCalled();
  });

  it("does not throw when session.update rejects", async () => {
    const update = mock(async () => {
      throw new Error("transport failure");
    });
    const ctx = createCtx(update);

    await expect(updateInternalSession({ ctx, sessionId: SESSION_ID, title: NEW_TITLE })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not throw when client.session.update is missing", async () => {
    const ctx = { client: { session: {} }, directory: DIRECTORY } as never as PluginInput;

    await expect(
      updateInternalSession({ ctx, sessionId: SESSION_ID, title: NEW_TITLE }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op when title is empty after trimming", async () => {
    const update = mock(async () => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: SESSION_ID, title: "   " });

    expect(update).not.toHaveBeenCalled();
  });
});
```

```typescript
// Code to ADD to src/utils/internal-session.ts (append after deleteInternalSession).
// Imports already exist; reuse extractErrorMessage, defaultLogger, isRecord, nonEmpty, LOG_MODULE.

interface SessionUpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title: string };
  readonly query: { readonly directory: string };
}

interface SessionUpdateClient {
  readonly update: (request: SessionUpdateRequest) => Promise<unknown>;
}

function hasSessionUpdate(session: unknown): session is SessionUpdateClient {
  return isRecord(session) && typeof session.update === "function";
}

export interface UpdateInternalSessionInput {
  readonly ctx: PluginInput;
  readonly sessionId: string | null;
  readonly title: string;
  readonly logger?: Logger;
}

const SESSION_UPDATE_UNAVAILABLE = "ctx.client.session.update is unavailable";

function formatUpdateWarning(sessionId: string, reason: unknown): string {
  return `Failed to update internal session ${sessionId} title: ${extractErrorMessage(reason)}`;
}

function warnUpdateFailure(logger: Logger, sessionId: string, reason: unknown): void {
  try {
    logger.warn(LOG_MODULE, formatUpdateWarning(sessionId, reason));
  } catch {
    // Logging must not make updateInternalSession throw.
  }
}

export async function updateInternalSession(input: UpdateInternalSessionInput): Promise<void> {
  if (input.sessionId === null) return;
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return;

  const logger = input.logger ?? defaultLogger;
  const session: unknown = input.ctx.client.session;
  if (!hasSessionUpdate(session)) {
    warnUpdateFailure(logger, input.sessionId, SESSION_UPDATE_UNAVAILABLE);
    return;
  }

  try {
    await session.update({
      path: { id: input.sessionId },
      body: { title: trimmed },
      query: { directory: input.ctx.directory },
    });
  } catch (error) {
    warnUpdateFailure(logger, input.sessionId, error);
  }
}
```

**Verify:** `bun test tests/utils/internal-session-update.test.ts`
**Commit:** `feat(spawn-agent): add updateInternalSession helper for title updates`

---

## Batch 2: Naming Layer (parallel - 1 implementer)

All tasks in this batch depend on Batch 1 completing (imports `AGENT_ROLE_LABELS`, `agentRoleLabel` from 1.1).
Tasks: 2.1

### Task 2.1: Spawn session namer (中文语义化标题生成器)
**File:** `src/tools/spawn-agent/naming.ts`
**Test:** `tests/tools/spawn-agent/naming.test.ts`
**Depends:** 1.1 (imports `agentRoleLabel`)
**Domain:** general

> Senior engineer's calls (gaps in design):
> 1. Outcome → status mapping: design says success/blocked/failure → 已完成/阻塞/失败. I also map `task_error` → `失败`, and `hard_failure` → `失败` (both surface as the same Chinese label since the user-facing distinction is "did it complete or not").
> 2. Description-vs-role precedence: design says "description 优先级高于 agent fallback". I implement: if description (after trim) is non-empty, use it as the summary; otherwise use the Chinese role label as the summary. The role label is also appended in parentheses to the agent role suffix when description IS used, so the user can still see both. Concretely: with description, summary = `${description}`; without, summary = `${roleLabel}`.
> 3. Truncation: design says "truncation must keep status word, prefer truncating summary". The existing `buildTitle` from `@/utils/conversation-title/format` already enforces exactly this contract (status + ": " is fixed, summary is truncated with ellipsis). I reuse it directly — no custom truncation in this module.

```typescript
// tests/tools/spawn-agent/naming.test.ts
import { describe, expect, it } from "bun:test";

import { buildSpawnCompletionTitle, buildSpawnRunningTitle } from "@/tools/spawn-agent/naming";

describe("buildSpawnRunningTitle", () => {
  it("uses 执行中 status with description as summary when description provided", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
      }),
    ).toBe("执行中: 修复后端权限校验");
  });

  it("falls back to Chinese role label when description is missing", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "implementer-backend",
        description: "",
      }),
    ).toBe("执行中: 后端实现");
  });

  it("falls back to Chinese role label when description is whitespace only", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "reviewer",
        description: "   ",
      }),
    ).toBe("执行中: 代码审查");
  });

  it("strips spawn-agent. prefix from unknown agent name in fallback", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "spawn-agent.weird-tool",
        description: "",
      }),
    ).toBe("执行中: weird-tool");
  });

  it("truncates long description but always preserves status prefix", () => {
    const longDescription = "这是一段非常非常非常非常非常非常非常非常非常非常长的任务描述用来测试截断逻辑";
    const title = buildSpawnRunningTitle({ agent: "reviewer", description: longDescription }, 20);
    expect(title.startsWith("执行中: ")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns 执行中: 子任务 when both description and agent are empty", () => {
    expect(buildSpawnRunningTitle({ agent: "", description: "" })).toBe("执行中: 子任务");
  });
});

describe("buildSpawnCompletionTitle", () => {
  it("maps success outcome to 已完成 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
        outcome: "success",
      }),
    ).toBe("已完成: 修复后端权限校验");
  });

  it("maps blocked outcome to 阻塞 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "审查 PR #42",
        outcome: "blocked",
      }),
    ).toBe("阻塞: 审查 PR #42");
  });

  it("maps task_error outcome to 失败 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-frontend",
        description: "登录页样式调整",
        outcome: "task_error",
      }),
    ).toBe("失败: 登录页样式调整");
  });

  it("maps hard_failure outcome to 失败 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "planner",
        description: "拆解任务",
        outcome: "hard_failure",
      }),
    ).toBe("失败: 拆解任务");
  });

  it("uses Chinese role fallback when description missing on completion", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "",
        outcome: "success",
      }),
    ).toBe("已完成: 代码审查");
  });
});
```

```typescript
// src/tools/spawn-agent/naming.ts
import { buildTitle, TITLE_STATUS, type TitleStatus } from "@/utils/conversation-title/format";

import { agentRoleLabel } from "./agent-roles";
import { SPAWN_OUTCOMES, type SpawnOutcome } from "./types";

const DEFAULT_MAX_LENGTH = 50;
const RUNNING_STATUS: TitleStatus = TITLE_STATUS.EXECUTING;

export interface SpawnRunningTitleInput {
  readonly agent: string;
  readonly description: string;
}

export interface SpawnCompletionTitleInput {
  readonly agent: string;
  readonly description: string;
  readonly outcome: SpawnOutcome;
}

function pickSummary(input: SpawnRunningTitleInput): string {
  const trimmed = input.description.trim();
  if (trimmed.length > 0) return trimmed;
  return agentRoleLabel(input.agent);
}

function outcomeToStatus(outcome: SpawnOutcome): TitleStatus {
  if (outcome === SPAWN_OUTCOMES.SUCCESS) return TITLE_STATUS.DONE;
  if (outcome === SPAWN_OUTCOMES.BLOCKED) return TITLE_STATUS.BLOCKED;
  return TITLE_STATUS.FAILED;
}

export function buildSpawnRunningTitle(input: SpawnRunningTitleInput, maxLength: number = DEFAULT_MAX_LENGTH): string {
  return buildTitle({ status: RUNNING_STATUS, summary: pickSummary(input) }, maxLength);
}

export function buildSpawnCompletionTitle(
  input: SpawnCompletionTitleInput,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  return buildTitle({ status: outcomeToStatus(input.outcome), summary: pickSummary(input) }, maxLength);
}
```

**Verify:** `bun test tests/tools/spawn-agent/naming.test.ts`
**Commit:** `feat(spawn-agent): add Chinese semantic session title namer`

---

## Batch 3: Tool Integration (parallel - 1 implementer)

This batch depends on Batch 1 (1.1, 1.2) and Batch 2 (2.1) completing.
Tasks: 3.1

### Task 3.1: Wire namer into spawn-agent tool (create + complete)
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** `tests/tools/spawn-agent/tool.test.ts` (UPDATE existing)
**Depends:** 1.1, 1.2, 2.1
**Domain:** general

> Senior engineer's calls (gaps in design):
> 1. The transient-retry path currently calls `deleteInternalSession` with `agent: "spawn-agent.transient"` purely as a log label. I leave this string as-is. It is a logger key, not a user-visible title, and changing it would conflate two unrelated naming concerns.
> 2. Order at completion: I call `updateInternalSession` (set terminal title) BEFORE `deleteInternalSession` for the success / hard_failure paths. Reasoning: a terminal-title update on a session that the next line will delete is wasted work for SUCCESS (the session vanishes anyway), but for `hard_failure` the session deletion happens too. Actually, in both delete-paths the title update is moot since the session disappears. So I only call `updateInternalSession` for the PRESERVED paths (`task_error`, `blocked`) — those are the ones that survive in the registry and remain visible in Octto. This matches the design's "子会话完成后，根据 outcome 更新为终态标题" intent: the user only sees titles of sessions that still exist.
> 3. Empty / placeholder description: `normalizeSpawnAgentArgs` requires `description` as a non-empty string at the schema level (existing `taskObjectSchema` has `description: tool.schema.string()` with no default). However `pickSummary` still defends against whitespace-only descriptions, so we don't add extra validation here.

**Step A: Update existing test file to assert new behavior**

Replace the assertion `expect(createCall?.body.title).toBe("spawn-agent.codebase-analyzer");` with the new Chinese semantic title assertion. Add a new test verifying terminal-title update on task_error.

```typescript
// tests/tools/spawn-agent/tool.test.ts
import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const SESSION_ID = "session_1";
const DIRECTORY = "/tmp/repo";
const AGENT = "codebase-analyzer";
const PROMPT = "inspect the code";
const DESCRIPTION = "Inspect code";
const TASK_ERROR_OUTPUT = "TEST FAILED: keep this session resumable";
const SUCCESS_OUTPUT = "all done";
const MAX_RESUMES = 2;
const TTL_HOURS = 1;
const TASK = { agent: AGENT, prompt: PROMPT, description: DESCRIPTION } as const;

interface CreateRequest {
  readonly body: { readonly title?: string };
  readonly query: { readonly directory: string };
}

interface UpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title?: string };
  readonly query: { readonly directory: string };
}

const createRegistry = () => createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });

interface CtxOptions {
  readonly output: string;
  readonly deleteSession: ReturnType<typeof mock>;
  readonly updateSession?: ReturnType<typeof mock>;
}

function createCtx(options: CtxOptions): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: options.output }],
      },
    ],
  }));
  const update = options.updateSession ?? mock(async () => ({}));

  return {
    client: { session: { create, prompt, messages, delete: options.deleteSession, update } },
    directory: DIRECTORY,
  } as never;
}

describe("spawn-agent tool internal sessions", () => {
  it("creates internal sessions with Chinese semantic titles and retries delete on success", async () => {
    let deleteAttempts = 0;
    const deleteSession = mock(async () => {
      deleteAttempts += 1;
      if (deleteAttempts === 1) throw new Error("temporary delete failure");
      return {};
    });
    const ctx = createCtx({ output: SUCCESS_OUTPUT, deleteSession });
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    const createCall = ctx.client.session.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(createCall?.body.title).toBe("执行中: Inspect code");
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(0);
  });

  it("preserves task_error sessions, does not delete them, and updates title to 失败", async () => {
    const deleteSession = mock(async () => ({}));
    const updateSession = mock(async () => ({}));
    const ctx = createCtx({ output: TASK_ERROR_OUTPUT, deleteSession, updateSession });
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SESSION_ID);
    expect(deleteSession).not.toHaveBeenCalled();
    expect(registry.get(SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      agent: AGENT,
      description: DESCRIPTION,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });

    const updateCall = updateSession.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.path.id).toBe(SESSION_ID);
    expect(updateCall?.body.title).toBe("失败: Inspect code");
  });

  it("uses Chinese role label fallback when description is empty", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx({ output: SUCCESS_OUTPUT, deleteSession });
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    await tool.execute(
      { agents: [{ agent: "reviewer", prompt: PROMPT, description: "" }] },
      { metadata: () => {} } as never,
    );

    const createCall = ctx.client.session.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 代码审查");
  });
});
```

**Step B: Update `src/tools/spawn-agent/tool.ts`**

Apply these targeted edits. Do NOT rewrite the whole file.

Edit 1: Add imports (after the existing `"./types"` import on line 16):

```typescript
import { updateInternalSession } from "@/utils/internal-session";
import { buildSpawnCompletionTitle, buildSpawnRunningTitle } from "./naming";
```

Note: `updateInternalSession` is from the SAME module as `createInternalSession` / `deleteInternalSession`, so update the existing line 9 import to also include `updateInternalSession`:

```typescript
// BEFORE (line 9):
import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

// AFTER:
import { createInternalSession, deleteInternalSession, updateInternalSession } from "@/utils/internal-session";
```

Edit 2: Replace the hardcoded title in `executeAgentSessionWith` (line 240):

```typescript
// BEFORE:
const session = await createInternalSession({ ctx, title: `spawn-agent.${task.agent}` });

// AFTER:
const session = await createInternalSession({
  ctx,
  title: buildSpawnRunningTitle({ agent: task.agent, description: task.description }),
});
```

Edit 3: In `runAgent` (around line 347-351), update preserved sessions' title before returning. Locate this block:

```typescript
// BEFORE:
if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
  await deleteInternalSession({ ctx, sessionId: settled.value.sessionId, agent: task.agent });
  return result;
}
return preserveIfNeeded(options.registry, result);

// AFTER:
if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
  await deleteInternalSession({ ctx, sessionId: settled.value.sessionId, agent: task.agent });
  return result;
}
await updateInternalSession({
  ctx,
  sessionId: settled.value.sessionId,
  title: buildSpawnCompletionTitle({
    agent: task.agent,
    description: task.description,
    outcome: result.outcome,
  }),
});
return preserveIfNeeded(options.registry, result);
```

No other changes are needed in `tool.ts`. The `dispatchTasks`, `runParallelAgents`, schema definitions, etc. all stay as-is. The progress-bar metadata strings that show `Running ${agent}...` / `${agent} done` are tool-output transient text (not session titles), and are intentionally left in English for log-correlation purposes.

**Verify:** `bun test tests/tools/spawn-agent/tool.test.ts && bun run typecheck`
**Commit:** `feat(spawn-agent): use Chinese semantic titles for internal sessions`

---

## Batch 4: Integration Test (parallel - 1 implementer)

Depends on Batch 3 (3.1) completing.
Tasks: 4.1

### Task 4.1: End-to-end integration test for naming + lifecycle
**File:** `tests/tools/spawn-agent/naming-integration.test.ts`
**Test:** self (this IS the test)
**Depends:** 3.1
**Domain:** general

> Senior engineer's call: the existing `tests/tools/spawn-agent/tool.test.ts` already covers the title-at-create and title-on-task_error paths after Task 3.1. This new file validates the cross-module contract specifically: namer + role-labels + tool integration produce the expected session-list visible strings end-to-end, including the success path's create-title (which the user sees during execution before the session is deleted) and the blocked path's terminal title. It also acts as a regression guard for the design's stated outcome → status mapping.

```typescript
// tests/tools/spawn-agent/naming-integration.test.ts
import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";

const SESSION_ID = "session_int";
const DIRECTORY = "/tmp/repo";
const BLOCKED_OUTPUT = "BLOCKED: waiting for clarification on API contract";
const SUCCESS_OUTPUT = "完成";
const REGISTRY_OPTS = { maxResumes: 2, ttlHours: 1 } as const;

interface CreateRequest {
  readonly body: { readonly title?: string };
}

interface UpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title?: string };
}

function createCtx(assistantOutput: string) {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: assistantOutput }],
      },
    ],
  }));
  const update = mock(async () => ({}));
  const del = mock(async () => ({}));
  const ctx = {
    client: { session: { create, prompt, messages, delete: del, update } },
    directory: DIRECTORY,
  } as never as PluginInput;
  return { ctx, create, update, delete: del };
}

describe("spawn-agent naming integration", () => {
  it("success path: session is created with 执行中 title, then deleted (no terminal-title write)", async () => {
    const stubs = createCtx(SUCCESS_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [
          {
            agent: "implementer-backend",
            prompt: "implement endpoint",
            description: "新增登录接口",
          },
        ],
      },
      { metadata: () => {} } as never,
    );

    const createCall = stubs.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 新增登录接口");

    expect(stubs.delete).toHaveBeenCalledTimes(1);
    expect(stubs.update).not.toHaveBeenCalled();
  });

  it("blocked path: session is preserved and title is updated to 阻塞", async () => {
    const stubs = createCtx(BLOCKED_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [
          {
            agent: "reviewer",
            prompt: "review the PR",
            description: "审查 PR #42",
          },
        ],
      },
      { metadata: () => {} } as never,
    );

    expect(stubs.delete).not.toHaveBeenCalled();
    expect(stubs.update).toHaveBeenCalledTimes(1);

    const updateCall = stubs.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.path.id).toBe(SESSION_ID);
    expect(updateCall?.body.title).toBe("阻塞: 审查 PR #42");
    expect(registry.get(SESSION_ID)).not.toBeNull();
  });

  it("missing description falls back to Chinese role label across the full pipeline", async () => {
    const stubs = createCtx(SUCCESS_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [{ agent: "implementer-frontend", prompt: "tweak ui", description: "" }],
      },
      { metadata: () => {} } as never,
    );

    const createCall = stubs.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 前端实现");
  });
});
```

**Verify:** `bun test tests/tools/spawn-agent/naming-integration.test.ts && bun run check`
**Commit:** `test(spawn-agent): add integration coverage for Chinese session titles`
