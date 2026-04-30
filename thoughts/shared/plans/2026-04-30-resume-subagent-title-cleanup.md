---
date: 2026-04-30
topic: "resume-subagent-title-cleanup"
issue: 14
scope: spawn-agent
contract: none
---

# Resume Subagent Title Cleanup Implementation Plan

**Goal:** Stop the stale `失败:` child-session title from staying visible after a preserved subagent is successfully resumed by syncing the session title to its real terminal status before any cleanup runs.

**Architecture:** In `resume-subagent.ts`, on every terminal outcome path (success, hard_failure, blocked, task_error, max-resumes), call the existing `buildSpawnCompletionTitle` from `spawn-agent/naming` plus the existing `updateInternalSession` helper to overwrite the preserved session's title before `cleanup` deletes it. Title update is best-effort and never overrides the real resume result. No Octto / UI / main-session changes. Single domain (general): all changes are in `src/tools/resume-subagent.ts` and its test file.

**Design:** [thoughts/shared/designs/2026-04-30-resume-subagent-title-cleanup-design.md](../designs/2026-04-30-resume-subagent-title-cleanup-design.md)

**Contract:** none (single-domain plan, no frontend tasks)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [independent files - tests + impl land together]
```

Both tasks target separate files (`src/tools/resume-subagent.ts` and `tests/tools/resume-subagent.test.ts`). They share a common spec (this plan) so they can be implemented in parallel; the executor verifies via `bun test tests/tools/resume-subagent.test.ts` once both land.

---

## Batch 1: Resume Subagent Title Sync (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Sync preserved session title before cleanup in resume_subagent
**File:** `src/tools/resume-subagent.ts`
**Test:** `tests/tools/resume-subagent.test.ts` (covered by Task 1.2)
**Depends:** none
**Domain:** general

Implementation notes:

- Import `buildSpawnCompletionTitle` from `./spawn-agent/naming` and `updateInternalSession` from `@/utils/internal-session`. These already exist; do NOT create new helpers.
- Add a single helper `syncResumedTitle(ctx, record, outcome)` that calls `updateInternalSession` with the title produced by `buildSpawnCompletionTitle({ agent: record.agent, description: record.description, outcome })`. `updateInternalSession` is already best-effort: it logs and swallows errors, so callers do not need their own try/catch. The reason it lives in a tiny helper rather than being inlined: keeps `runResume` and `handleMaxResumes` readable and ensures every terminal branch uses identical title logic.
- Call `syncResumedTitle` in TWO places:
  - `handleMaxResumes`: BEFORE `cleanup`. The synthesized outcome here is `hard_failure` (mirror what the formatted result already says), so the title becomes `失败: <description>`.
  - `runResume`: BEFORE `cleanup` on the success / hard_failure branch (use `result.outcome`), AND on the task_error / blocked branch (which keeps the session preserved, no cleanup, but the live title must reflect the new outcome). The blocked branch produces `阻塞: ...` and task_error produces `失败: ...`, so even when the session stays preserved its title becomes accurate.
- The `null` / `MISSING_SESSION` path already short-circuits inside `formatResumeResult` because there is no preserved record: do not attempt a title update when `record` is missing in the early `ABSENT_REASON` branch.
- `record.agent` and `record.description` are already on `PreservedRecord` (see `src/tools/spawn-agent/registry.ts`); no schema change needed.
- Use `result.outcome` from `runResume` for the resumed branch so the title matches what `formatResumeResult` reports. Use `SPAWN_OUTCOMES.HARD_FAILURE` literal for `handleMaxResumes` because that branch synthesizes a `hardFailure(...)` payload.
- Keep all other behavior unchanged: `cleanup`, `preserve` semantics (registry only loses the entry on success / hard_failure / max-resumes), and `formatResumeResult` output.

Complete reference patch (apply on top of current `src/tools/resume-subagent.ts`):

```typescript
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { config } from "@/utils/config";
import { updateInternalSession } from "@/utils/internal-session";
import { classifySpawnError, INTERNAL_CLASSES, type InternalClass } from "./spawn-agent/classify";
import { buildSpawnCompletionTitle } from "./spawn-agent/naming";
import type { PreservedRecord, PreservedRegistry } from "./spawn-agent/registry";
import { buildSubagentResumePrompt } from "./spawn-agent/resume-prompt";
import { type ResumeSubagentResult, SPAWN_OUTCOMES, type SpawnOutcome } from "./spawn-agent/types";

export interface ResumeSubagentToolOptions {
  readonly registry: PreservedRegistry;
}

interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: readonly MessagePart[];
}

interface SessionMessagesResponse {
  readonly data?: readonly SessionMessage[];
}

interface SessionDeleteClient {
  readonly delete: (input: {
    readonly path: { readonly id: string };
    readonly query: { readonly directory: string };
  }) => Promise<unknown>;
}

interface Attempt {
  readonly class: InternalClass;
  readonly output: string;
}

const TOOL_DESCRIPTION = `Resume a previously preserved subagent session after a task_error or blocked outcome.
Coordinator agents use this when spawn_agent reports a resumable SessionID.`;
const ABSENT_REASON = "Session not preserved or expired.";
const MAX_RESUMES_REASON = "Maximum resume count reached.";
const MISSING_SESSION = "-";
const RESULT_HEADER = "## resume_subagent Result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSessionDelete(value: unknown): value is SessionDeleteClient {
  return isRecord(value) && typeof value.delete === "function";
}

function getStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  if (!isRecord(error.response)) return null;
  return typeof error.response.status === "number" ? error.response.status : null;
}

function readAssistantText(messages: readonly SessionMessage[]): string {
  const assistant = messages.filter((message) => message.info?.role === "assistant").pop();
  return (
    assistant?.parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function toPublicOutcome(kind: InternalClass): SpawnOutcome {
  switch (kind) {
    case INTERNAL_CLASSES.SUCCESS:
      return SPAWN_OUTCOMES.SUCCESS;
    case INTERNAL_CLASSES.TASK_ERROR:
      return SPAWN_OUTCOMES.TASK_ERROR;
    case INTERNAL_CLASSES.BLOCKED:
      return SPAWN_OUTCOMES.BLOCKED;
    case INTERNAL_CLASSES.HARD_FAILURE:
    case INTERNAL_CLASSES.TRANSIENT:
      return SPAWN_OUTCOMES.HARD_FAILURE;
  }
}

function formatResumeResult(result: ResumeSubagentResult): string {
  const sessionId = result.sessionId ?? MISSING_SESSION;
  return [
    RESULT_HEADER,
    "",
    `**Outcome**: ${result.outcome}`,
    `**SessionID**: ${sessionId}`,
    `**Resume count**: ${result.resumeCount}`,
    "",
    "### Result",
    "",
    result.output,
  ].join("\n");
}

function hardFailure(output: string, sessionId: string | null, resumeCount: number): ResumeSubagentResult {
  return {
    outcome: SPAWN_OUTCOMES.HARD_FAILURE,
    sessionId,
    resumeCount,
    output,
  };
}

async function deleteSession(ctx: PluginInput, sessionId: string): Promise<void> {
  const session = ctx.client.session;
  if (!hasSessionDelete(session)) return;
  await session.delete({ path: { id: sessionId }, query: { directory: ctx.directory } }).catch((_error: unknown) => {
    /* cleanup should not hide the primary resume result */
  });
}

async function syncResumedTitle(ctx: PluginInput, record: PreservedRecord, outcome: SpawnOutcome): Promise<void> {
  await updateInternalSession({
    ctx,
    sessionId: record.sessionId,
    title: buildSpawnCompletionTitle({ agent: record.agent, description: record.description, outcome }),
  });
}

async function cleanup(ctx: PluginInput, registry: PreservedRegistry, sessionId: string): Promise<void> {
  registry.remove(sessionId);
  await deleteSession(ctx, sessionId);
}

async function resumeSession(ctx: PluginInput, sessionId: string, prompt: string): Promise<Attempt> {
  try {
    await ctx.client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: prompt }] } });
    const response = (await ctx.client.session.messages({ path: { id: sessionId } })) as SessionMessagesResponse;
    const output = readAssistantText(response.data ?? []);
    const classification = classifySpawnError({ assistantText: output });
    return { class: classification.class, output: output || classification.reason };
  } catch (error) {
    const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error) });
    return { class: classification.class, output: classification.reason };
  }
}

async function handleMaxResumes(
  ctx: PluginInput,
  registry: PreservedRegistry,
  record: PreservedRecord,
): Promise<string> {
  await syncResumedTitle(ctx, record, SPAWN_OUTCOMES.HARD_FAILURE);
  await cleanup(ctx, registry, record.sessionId);
  return formatResumeResult(hardFailure(MAX_RESUMES_REASON, record.sessionId, record.resumeCount));
}

async function runResume(
  ctx: PluginInput,
  registry: PreservedRegistry,
  record: PreservedRecord,
  hint: string | undefined,
): Promise<string> {
  const prompt = buildSubagentResumePrompt({ errorType: record.outcome, hint });
  const attempt = await resumeSession(ctx, record.sessionId, prompt);
  const resumeCount = registry.incrementResume(record.sessionId);
  const result: ResumeSubagentResult = {
    outcome: toPublicOutcome(attempt.class),
    sessionId: record.sessionId,
    resumeCount,
    output: attempt.output,
  };
  await syncResumedTitle(ctx, record, result.outcome);
  if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
    await cleanup(ctx, registry, record.sessionId);
  }
  return formatResumeResult(result);
}

export function createResumeSubagentTool(ctx: PluginInput, options: ResumeSubagentToolOptions): ToolDefinition {
  // Coordinator-only use is a prompt contract, not a runtime ACL; the registry is the runtime guard.
  return tool({
    description: TOOL_DESCRIPTION,
    args: {
      session_id: tool.schema.string().min(1).describe("Preserved subagent session id"),
      hint: tool.schema.string().optional().describe("Optional coordinator hint for the resumed subagent"),
    },
    execute: async (args) => {
      const record = options.registry.get(args.session_id);
      if (record === null) return formatResumeResult(hardFailure(ABSENT_REASON, null, 0));
      if (record.resumeCount >= config.subagent.maxResumesPerSession)
        return handleMaxResumes(ctx, options.registry, record);
      return runResume(ctx, options.registry, record, args.hint);
    },
  });
}
```

Decision rationale (gap-filling):

- The design says "调用 spawn-agent 的 completion title builder" without specifying call site count. I chose to add ONE small helper (`syncResumedTitle`) and call it from BOTH `runResume` and `handleMaxResumes` so every terminal branch (success, hard_failure, blocked, task_error, max-resumes) gets identical treatment. This keeps coverage uniform and avoids duplicate `buildSpawnCompletionTitle({ ... })` argument lists.
- The design says title update is best-effort. `updateInternalSession` already swallows its own errors and warns via the project logger, so no extra try/catch wrapper is required at the call site. This keeps the call sites readable and matches existing patterns in `src/tools/spawn-agent/tool.ts` (line 355: `updateInternalSession({...})` is also unwrapped).
- The `ABSENT_REASON` early-return path stays untouched: there is no `record` to read agent/description from. The design only requires title sync for preserved sessions.

**Verify:** `bun test tests/tools/resume-subagent.test.ts && bun run typecheck`
**Commit:** `feat(spawn-agent): sync preserved session title before resume cleanup`

---

### Task 1.2: Cover resume_subagent title sync in tests
**File:** `tests/tools/resume-subagent.test.ts`
**Test:** self
**Depends:** none
**Domain:** general

Implementation notes:

- Extend the existing `FakeRecorder` to also capture title updates, and extend the fake `session` returned by `buildSession` with an `update` handler. The shape mirrors `src/utils/internal-session.ts` `SessionUpdateRequest`: `{ path: { id }, body: { title }, query: { directory } }`. The recorder stores `{ id, title }` per call.
- Three new test cases on top of the existing four:
  1. Successful resume sets the title to `已完成: <description>` BEFORE the delete call. Assert ordering by recording both update and delete in a single ordered array OR by snapshotting `recorder.updateCalls` BEFORE the prompt resolution and verifying its length grows as expected; simpler approach: assert both lists' final state, plus assert that the update call uses the success status prefix.
  2. Resume that classifies as `task_error` updates the title to `失败: <description>` and KEEPS the registry entry (no delete, registry size stays 1, resume count is 1). The description-based assistant text used here must trip the task_error classifier. Use a sentinel string the existing classifier already maps to `task_error`: see `src/tools/spawn-agent/classify-tokens.ts` and `tests/tools/spawn-agent/classify.test.ts` for the exact tokens. If the simplest task_error trigger is a thrown non-transient error, use `promptError: new Error("validation failed: missing field")` and check `classify.test.ts` for the right sentinel. As a fallback that is guaranteed to work today: trigger a `blocked` classification instead, since the title-sync code path is identical (any non-success / non-hard-failure outcome keeps the session preserved and only updates the title).
  3. Resume that classifies as `blocked` updates title to `阻塞: <description>`, keeps the registry entry, and does NOT delete the session.
- Title prefixes must come from `TITLE_STATUS` in `src/utils/conversation-title/format.ts`. To stay loosely coupled, assert the title CONTAINS the description (e.g. `Resume preserved task`) and STARTS WITH the appropriate status prefix. Look up the exact prefix at runtime by importing `buildSpawnCompletionTitle` from the same module and computing the expected string in the test, rather than hard-coding `已完成:` / `失败:` / `阻塞:` literals. This shields the tests from any future prefix wording change.
- Fourth new test case: when the registry is at `maxResumesPerSession`, `handleMaxResumes` ALSO emits a title update (status: hard_failure) before deleting. Extend the existing "stops at the configured maximum resume count" test or add a dedicated assertion: `expect(recorder.updateCalls.length).toBe(1)` and the title equals `buildSpawnCompletionTitle({ agent: AGENT, description: DESCRIPTION, outcome: SPAWN_OUTCOMES.HARD_FAILURE })`.
- Fifth new test case: title update failures must NOT change resume outcome. Replace `update` with `async () => { throw new Error("update failed"); }`. Assert the resume still returns `Outcome: success` and that `recorder.deleteCalls` still contains `SESSION_ID`. This is implicitly covered by `updateInternalSession` already swallowing errors, but add an explicit test so a regression in error-swallowing is caught.

Complete reference patch (apply on top of current `tests/tools/resume-subagent.test.ts`):

```typescript
import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createResumeSubagentTool } from "../../src/tools/resume-subagent";
import { buildSpawnCompletionTitle } from "../../src/tools/spawn-agent/naming";
import { createPreservedRegistry } from "../../src/tools/spawn-agent/registry";
import { buildSubagentResumePrompt } from "../../src/tools/spawn-agent/resume-prompt";
import { SPAWN_OUTCOMES } from "../../src/tools/spawn-agent/types";
import { config } from "../../src/utils/config";

const SESSION_ID = "session-resume";
const AGENT = "implementer-general";
const DESCRIPTION = "Resume preserved task";
const TTL_HOURS = 1;
const SUCCESS_OUTPUT = "Implementation completed successfully.";
const TRANSIENT_MESSAGE = "fetch failed";
const BLOCKED_OUTPUT = "BLOCKED: missing credentials, escalate to operator.";

interface PromptCall {
  readonly id: string;
  readonly text: string;
}

interface UpdateCall {
  readonly id: string;
  readonly title: string;
}

interface FakeRecorder {
  readonly promptCalls: PromptCall[];
  readonly updateCalls: UpdateCall[];
  readonly deleteCalls: string[];
}

interface FakeOptions {
  readonly assistantText?: string;
  readonly promptError?: Error;
  readonly updateError?: Error;
}

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

function createRegistry() {
  return createPreservedRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: TTL_HOURS,
  });
}

function preserveSession(registry: ReturnType<typeof createRegistry>): void {
  registry.preserve({
    sessionId: SESSION_ID,
    agent: AGENT,
    description: DESCRIPTION,
    outcome: SPAWN_OUTCOMES.TASK_ERROR,
  });
}

function buildSession(recorder: FakeRecorder, options: FakeOptions) {
  return {
    prompt: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly parts: readonly { readonly text: string }[] };
    }) => {
      if (options.promptError) throw options.promptError;
      recorder.promptCalls.push({
        id: input.path.id,
        text: input.body.parts[0]?.text ?? "",
      });
    },
    messages: async () => ({
      data: [
        {
          info: { role: "assistant" as const },
          parts: [{ type: "text", text: options.assistantText ?? SUCCESS_OUTPUT }],
        },
      ],
    }),
    update: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly title: string };
    }) => {
      if (options.updateError) throw options.updateError;
      recorder.updateCalls.push({ id: input.path.id, title: input.body.title });
    },
    delete: async (input: { readonly path: { readonly id: string } }) => {
      recorder.deleteCalls.push(input.path.id);
    },
  };
}

function createCtx(options: FakeOptions = {}): { readonly ctx: PluginInput; readonly recorder: FakeRecorder } {
  const recorder: FakeRecorder = { promptCalls: [], updateCalls: [], deleteCalls: [] };
  const ctx = {
    directory: "/tmp/resume-subagent-test",
    client: { session: buildSession(recorder, options) },
  } as unknown as PluginInput;
  return { ctx, recorder };
}

async function callExecute(toolDef: ReturnType<typeof createResumeSubagentTool>, args: unknown): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, {});
}

describe("createResumeSubagentTool", () => {
  it("returns a stable hard failure when the session is not preserved", async () => {
    const registry = createRegistry();
    const { ctx, recorder } = createCtx();
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain("**SessionID**: -");
    expect(output).toContain("Session not preserved or expired.");
    expect(recorder.promptCalls).toEqual([]);
    expect(recorder.updateCalls).toEqual([]);
  });

  it("stops at the configured maximum resume count and rewrites the title to the hard-failure form", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    for (let index = 0; index < config.subagent.maxResumesPerSession; index += 1) {
      registry.incrementResume(SESSION_ID);
    }
    const { ctx, recorder } = createCtx();
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain(`**Resume count**: ${config.subagent.maxResumesPerSession}`);
    expect(output).toContain("Maximum resume count reached.");
    expect(recorder.promptCalls).toEqual([]);
    expect(recorder.updateCalls).toEqual([
      {
        id: SESSION_ID,
        title: buildSpawnCompletionTitle({
          agent: AGENT,
          description: DESCRIPTION,
          outcome: SPAWN_OUTCOMES.HARD_FAILURE,
        }),
      },
    ]);
    expect(registry.size()).toBe(0);
  });

  it("resumes once, rewrites the title to the success form, and cleans up the preserved session", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({ assistantText: SUCCESS_OUTPUT });
    const toolDef = createResumeSubagentTool(ctx, { registry });
    const hint = "Run the focused test before reporting.";

    const output = await callExecute(toolDef, { session_id: SESSION_ID, hint });

    expect(output).toContain("**Outcome**: success");
    expect(output).toContain(`**SessionID**: ${SESSION_ID}`);
    expect(output).toContain("**Resume count**: 1");
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(recorder.promptCalls).toEqual([
      {
        id: SESSION_ID,
        text: buildSubagentResumePrompt({ errorType: SPAWN_OUTCOMES.TASK_ERROR, hint }),
      },
    ]);
    expect(recorder.updateCalls).toEqual([
      {
        id: SESSION_ID,
        title: buildSpawnCompletionTitle({
          agent: AGENT,
          description: DESCRIPTION,
          outcome: SPAWN_OUTCOMES.SUCCESS,
        }),
      },
    ]);
    expect(recorder.deleteCalls).toEqual([SESSION_ID]);
    expect(registry.size()).toBe(0);
  });

  it("classifies a transient resume failure as a terminal hard failure and rewrites the title", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({ promptError: new Error(TRANSIENT_MESSAGE) });
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain("**Resume count**: 1");
    expect(output).toContain(TRANSIENT_MESSAGE);
    expect(recorder.updateCalls).toEqual([
      {
        id: SESSION_ID,
        title: buildSpawnCompletionTitle({
          agent: AGENT,
          description: DESCRIPTION,
          outcome: SPAWN_OUTCOMES.HARD_FAILURE,
        }),
      },
    ]);
    expect(recorder.deleteCalls).toEqual([SESSION_ID]);
    expect(registry.size()).toBe(0);
  });

  it("rewrites the title to the blocked form and keeps the preserved session when resume returns blocked", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({ assistantText: BLOCKED_OUTPUT });
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: blocked");
    expect(recorder.updateCalls).toEqual([
      {
        id: SESSION_ID,
        title: buildSpawnCompletionTitle({
          agent: AGENT,
          description: DESCRIPTION,
          outcome: SPAWN_OUTCOMES.BLOCKED,
        }),
      },
    ]);
    expect(recorder.deleteCalls).toEqual([]);
    expect(registry.size()).toBe(1);
  });

  it("does not let title-update failures break the resume outcome", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({
      assistantText: SUCCESS_OUTPUT,
      updateError: new Error("update failed"),
    });
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: success");
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(recorder.deleteCalls).toEqual([SESSION_ID]);
    expect(registry.size()).toBe(0);
  });
});
```

Decision rationale (gap-filling):

- The design lists four explicit test scenarios (success, blocked, task_error, update-failure-does-not-break) plus implicit max-resumes coverage. I added five concrete `it(...)` blocks plus updates to the existing two unchanged-behavior cases. The total is six cases.
- The `task_error` scenario is collapsed into `blocked` because both follow the same code path (no cleanup, title update, registry preserved). Adding both would duplicate coverage with zero new branches; the existing classification tests in `tests/tools/spawn-agent/classify*.test.ts` already cover task_error vs blocked discrimination.
- I import `buildSpawnCompletionTitle` from the same module the impl uses to produce expected titles. This keeps tests resilient to future title format changes (status prefix wording, max length, etc.) while still asserting the correct outcome enum is fed in.
- The fake `session.update` signature mirrors `src/utils/internal-session.ts` `SessionUpdateRequest` exactly, so the test exercises the same property path the production code traverses.
- The blocked sentinel `"BLOCKED: missing credentials, escalate to operator."` follows existing classify-token conventions used in `tests/tools/spawn-agent/classify.test.ts`. If the live classifier rejects this exact phrasing during executor implementation, swap it for any string the current `classifySpawnError` already maps to `INTERNAL_CLASSES.BLOCKED`; the test logic does not depend on the specific token, only on the resulting outcome.

**Verify:** `bun test tests/tools/resume-subagent.test.ts && bun run check`
**Commit:** `test(spawn-agent): cover resume_subagent title sync before cleanup`
