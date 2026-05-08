---
date: 2026-05-08
topic: "empty-subagent-result-defense"
issue: 55
scope: spawn-agent
contract: none
---

# Empty Subagent Assistant Result Defense Implementation Plan

**Goal:** Add a non-throwing re-read guard between `session.messages` and `classifySpawnError` in both the spawn path (`spawn-agent/tool.ts::executeAgentSessionWith`) and the resume path (`resume-subagent.ts::resumeSession`), so transiently-empty assistant outputs are recovered via a short backoff loop and persistently-empty outputs surface as a machine-readable `HARD_FAILURE` reason instead of the silent `"empty response"`.

**Architecture:** A new pure helper `readAssistantTextWithRetry` in `src/tools/spawn-agent/read-guard.ts` accepts the first-read output plus a `reread` callback and a `ReadGuardOptions`. Both call sites import it, pass the same first-read text plus a tightly-scoped `reread` closure that mirrors their existing `session.messages` invocation, and on `exhausted=true` throw a sentinel `Error` whose message is routed by the existing `try/catch → classifyThrown` path to `HARD_FAILURE` with reason `"empty assistant output after N read attempt(s)"`. `classify.ts`, `retry.ts`, `verifier.ts`, `generation-fence.ts`, `format.ts` are NOT modified.

**Design:** [thoughts/shared/designs/2026-05-08-empty-subagent-result-defense-design.md](../designs/2026-05-08-empty-subagent-result-defense-design.md)

**Contract:** none (single-domain backend/general; no frontend tasks)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - no deps]
  1.1 read-guard helper + tests          (introduces readAssistantTextWithRetry)
  1.2 config.subagent.readGuard field    (introduces config.subagent.readGuard, updates strict toEqual test)

Batch 2 (parallel): 2.1, 2.2 [integration - depends on batch 1]
  2.1 wire guard into spawn-agent/tool.ts (depends 1.1, 1.2)
  2.2 wire guard into resume-subagent.ts  (depends 1.1, 1.2)
```

Batches 2.1 and 2.2 touch DIFFERENT files (`tool.ts` vs `resume-subagent.ts`) and DIFFERENT test files; they are independent and run in parallel.

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Read-guard helper
**File:** `src/tools/spawn-agent/read-guard.ts`
**Test:** `tests/tools/spawn-agent/read-guard.test.ts`
**Depends:** none
**Domain:** general

Pure helper, exported reusable logic with multiple branches and trim/empty semantics. Test is required (semantic risk: behavioural correctness drives both call sites).

**Test (write FIRST, verify it fails before implementation exists):**

```typescript
// tests/tools/spawn-agent/read-guard.test.ts
import { describe, expect, it, mock } from "bun:test";

import { readAssistantTextWithRetry } from "@/tools/spawn-agent/read-guard";

const NO_SLEEP = async (_ms: number): Promise<void> => {};

describe("readAssistantTextWithRetry", () => {
  it("returns immediately when firstOutput is non-empty (no re-reads)", async () => {
    const reread = mock(async () => "should not be called");
    const result = await readAssistantTextWithRetry("hello", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "hello", extraReads: 0, exhausted: false });
    expect(reread).toHaveBeenCalledTimes(0);
  });

  it("treats whitespace-only firstOutput as empty and triggers re-reads", async () => {
    const reread = mock(async () => "recovered");
    const result = await readAssistantTextWithRetry("   \n\t  ", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result.output).toBe("recovered");
    expect(result.extraReads).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("returns first non-empty re-read and stops further re-reads", async () => {
    let calls = 0;
    const reread = mock(async () => {
      calls += 1;
      if (calls === 1) return "";
      if (calls === 2) return "found on second extra";
      return "should not be reached";
    });
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 3,
      backoffMs: [10, 20, 30],
      sleep: NO_SLEEP,
    });
    expect(result.output).toBe("found on second extra");
    expect(result.extraReads).toBe(2);
    expect(result.exhausted).toBe(false);
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it("marks exhausted when all re-reads return empty", async () => {
    const reread = mock(async () => "");
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "", extraReads: 2, exhausted: true });
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it("returns immediately exhausted when maxExtraReads is 0", async () => {
    const reread = mock(async () => "never called");
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 0,
      backoffMs: [],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "", extraReads: 0, exhausted: true });
    expect(reread).toHaveBeenCalledTimes(0);
  });

  it("propagates errors from reread without swallowing them", async () => {
    const boom = new Error("messages API exploded");
    const reread = mock(async () => {
      throw boom;
    });
    await expect(
      readAssistantTextWithRetry("", reread, {
        maxExtraReads: 2,
        backoffMs: [10, 20],
        sleep: NO_SLEEP,
      }),
    ).rejects.toBe(boom);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("uses the last backoffMs entry when maxExtraReads exceeds the array length", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const reread = mock(async () => "");
    await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 4,
      backoffMs: [50, 100],
      sleep,
    });
    expect(sleeps).toEqual([50, 100, 100, 100]);
  });

  it("sleeps before each re-read using backoffMs in order", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const reread = mock(async () => "");
    await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 2,
      backoffMs: [200, 500],
      sleep,
    });
    expect(sleeps).toEqual([200, 500]);
  });
});
```

**Implementation:**

```typescript
// src/tools/spawn-agent/read-guard.ts

export interface ReadGuardOptions {
  /** Number of extra reads after the first. Total attempts = 1 + maxExtraReads. */
  readonly maxExtraReads: number;
  /** Per-retry sleep durations (ms). If shorter than maxExtraReads, the last entry is reused. */
  readonly backoffMs: readonly number[];
  /** Optional sleep override for tests. Defaults to a setTimeout-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReadGuardResult {
  /** Trimmed-non-empty output if any read succeeded; "" if all reads were empty. */
  readonly output: string;
  /** Count of re-reads actually performed. 0 means the first read already had output. */
  readonly extraReads: number;
  /** True iff every read (first + all re-reads) returned empty/whitespace text. */
  readonly exhausted: boolean;
}

const DEFAULT_BACKOFF_FALLBACK_MS = 0;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function pickBackoff(backoffMs: readonly number[], index: number): number {
  if (backoffMs.length === 0) return DEFAULT_BACKOFF_FALLBACK_MS;
  if (index < backoffMs.length) return backoffMs[index];
  return backoffMs[backoffMs.length - 1];
}

/**
 * Re-read guard: if firstOutput is empty/whitespace, sleep+reread up to maxExtraReads times.
 * Returns the first non-empty result, or { exhausted: true, output: "" } if all attempts fail.
 * Errors from reread() are NOT caught — they propagate to the caller's existing try/catch.
 */
export async function readAssistantTextWithRetry(
  firstOutput: string,
  reread: () => Promise<string>,
  options: ReadGuardOptions,
): Promise<ReadGuardResult> {
  if (isNonEmpty(firstOutput)) {
    return { output: firstOutput, extraReads: 0, exhausted: false };
  }

  const sleep = options.sleep ?? defaultSleep;
  const maxExtraReads = options.maxExtraReads;

  for (let i = 0; i < maxExtraReads; i += 1) {
    await sleep(pickBackoff(options.backoffMs, i));
    const next = await reread();
    if (isNonEmpty(next)) {
      return { output: next, extraReads: i + 1, exhausted: false };
    }
  }

  return { output: "", extraReads: maxExtraReads, exhausted: true };
}
```

**Verify:** `bun test tests/tools/spawn-agent/read-guard.test.ts`
**Commit:** `feat(spawn-agent): add readAssistantTextWithRetry helper for empty-result defense`

---

### Task 1.2: Add `subagent.readGuard` config field
**File:** `src/utils/config.ts` (modify) — add a `readGuard` block under `subagent` with `maxExtraReads: 2` and `backoffMs: [200, 500]`.
**Test:** `tests/utils/config.test.ts` (modify) — extend the existing `"should have subagent defaults"` strict-equality test so it still passes with the new field, and add 2 small assertions verifying the readGuard defaults.
**Depends:** none
**Domain:** general

**Test edits (modify existing config.test.ts):**

The current test at line 195–218 uses `expect(config.subagent).toEqual({...})`. Strict `toEqual` will FAIL once a new field is added. Update the literal AND add focused assertions in the existing `subagent spawn-registry, verifier, fence config` describe block.

In `tests/utils/config.test.ts`, locate:

```typescript
    it("should have subagent defaults", async () => {
      const { config } = await import("../../src/utils/config");

      expect(config.subagent).toEqual({
        transientRetries: 2,
        transientBackoffMs: [5000, 15000],
        maxResumesPerSession: 3,
        failedSessionTtlHours: 24,
        resumeSweepIntervalMs: 600_000,
        spawnRegistryRunningTtlMs: 3_600_000,
        markerVerification: {
          enabled: true,
          timeoutMs: 15_000,
          maxOutputChars: 4000,
        },
        generationFence: {
          enabled: true,
        },
        diagnostics: {
          logEvents: true,
          includeInOutput: true,
        },
      });
    });
```

Replace the `toEqual({...})` literal with the version including `readGuard`:

```typescript
    it("should have subagent defaults", async () => {
      const { config } = await import("../../src/utils/config");

      expect(config.subagent).toEqual({
        transientRetries: 2,
        transientBackoffMs: [5000, 15000],
        maxResumesPerSession: 3,
        failedSessionTtlHours: 24,
        resumeSweepIntervalMs: 600_000,
        spawnRegistryRunningTtlMs: 3_600_000,
        markerVerification: {
          enabled: true,
          timeoutMs: 15_000,
          maxOutputChars: 4000,
        },
        generationFence: {
          enabled: true,
        },
        diagnostics: {
          logEvents: true,
          includeInOutput: true,
        },
        readGuard: {
          maxExtraReads: 2,
          backoffMs: [200, 500],
        },
      });
    });
```

Then add focused assertions at the end of the `describe("subagent spawn-registry, verifier, fence config", ...)` block (which begins at line 270). Insert before the closing `});`:

```typescript
  it("defines readGuard.maxExtraReads as a non-negative integer default of 2", () => {
    expect(config.subagent.readGuard.maxExtraReads).toBe(2);
    expect(Number.isInteger(config.subagent.readGuard.maxExtraReads)).toBe(true);
    expect(config.subagent.readGuard.maxExtraReads).toBeGreaterThanOrEqual(0);
  });

  it("defines readGuard.backoffMs as the conservative [200, 500] default", () => {
    expect(config.subagent.readGuard.backoffMs).toEqual([200, 500]);
  });
```

**Implementation (modify `src/utils/config.ts`):**

In the `subagent: { ... }` block (currently lines 203–225 of config.ts), add a `readGuard` field at the end of the object, BEFORE the closing brace, AFTER the existing `diagnostics: { ... }` field. Locate:

```typescript
    diagnostics: {
      logEvents: true,
      includeInOutput: true,
    },
  },
```

Append `readGuard` so the block becomes:

```typescript
    diagnostics: {
      logEvents: true,
      includeInOutput: true,
    },
    readGuard: {
      /** Extra reads after the first when assistant output is empty (total attempts = 1 + this). */
      maxExtraReads: 2,
      /** Per-retry sleep durations (ms). The last entry is reused if maxExtraReads exceeds length. */
      backoffMs: [200, 500] as readonly number[],
    },
  },
```

Do NOT change any other config field. Do NOT introduce new top-level constants — these defaults are inline because they are small and stable.

**Verify:** `bun test tests/utils/config.test.ts`
**Commit:** `feat(config): add subagent.readGuard defaults for empty-result defense`

---

## Batch 2: Integration (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Wire read-guard into spawn-agent tool
**File:** `src/tools/spawn-agent/tool.ts` (modify)
**Test:** `tests/tools/spawn-agent/tool.test.ts` (extend with two scenarios)
**Depends:** 1.1, 1.2 (imports `readAssistantTextWithRetry` from 1.1; reads `config.subagent.readGuard` from 1.2)
**Domain:** general

This task wires the guard into `executeAgentSessionWith`. On `exhausted=true` it throws a sentinel `Error` so the existing `try { ... } catch (error) { throw createSessionError(error, sessionId); }` path lifts the message into the thrown-classification flow (which produces `HARD_FAILURE` with the message as `reason`).

**Test edits (extend `tests/tools/spawn-agent/tool.test.ts`):**

The existing `createCtx` factory mocks `session.messages` to return one canned response forever. We need two new factories that vary by call count, and two new test cases. Add the helpers near `createCtx` (after line 74) and the test cases inside the existing `describe("spawn-agent tool internal sessions", ...)` block (which ends near line 358 — append before the closing `});`).

Add helpers (insert right after the existing `createCtx` function definition):

```typescript
function createCtxWithEmptyThenFilled(
  filledOutput: string,
  deleteSession: ReturnType<typeof mock>,
): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const update = mock(async () => ({}));
  let messageCalls = 0;
  const messages = mock(async () => {
    messageCalls += 1;
    if (messageCalls === 1) return { data: [] };
    return {
      data: [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: filledOutput }],
        },
      ],
    };
  });

  return {
    client: { session: { create, prompt, messages, update, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}

function createCtxWithAlwaysEmpty(deleteSession: ReturnType<typeof mock>): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const update = mock(async () => ({}));
  const messages = mock(async () => ({ data: [] }));

  return {
    client: { session: { create, prompt, messages, update, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}
```

Add tests (append inside the existing `describe("spawn-agent tool internal sessions", ...)` block):

```typescript
  it("recovers via re-read guard when the first session.messages call returns empty", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtxWithEmptyThenFilled(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SUCCESS_OUTPUT);
    expect(output).toContain(SPAWN_OUTCOMES.SUCCESS);
    // 1 first-read + at least 1 re-read = >= 2 calls
    expect(ctx.client.session.messages.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("classifies persistently-empty output as hard_failure with the enriched read-attempt reason", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtxWithAlwaysEmpty(deleteSession);
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SPAWN_OUTCOMES.HARD_FAILURE);
    expect(output).toContain("empty assistant output after");
    expect(output).not.toContain("empty response");
    // total reads = 1 + maxExtraReads (default 2) = 3 by default
    expect(ctx.client.session.messages.mock.calls.length).toBe(3);
  });
```

**Implementation (modify `src/tools/spawn-agent/tool.ts`):**

Add the import at the top of the imports block (after the other `./` imports):

```typescript
import { readAssistantTextWithRetry } from "./read-guard";
```

Add a sentinel-message builder near the other small helpers (e.g. right after `readAssistantText`):

```typescript
const EMPTY_OUTPUT_REASON_PREFIX = "empty assistant output after";

function buildEmptyReadReason(totalAttempts: number): string {
  return `${EMPTY_OUTPUT_REASON_PREFIX} ${totalAttempts} read attempt(s)`;
}
```

Modify `executeAgentSessionWith`. Locate the current return inside the `try { ... }`:

```typescript
    const messagesResp = (await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;

    return { sessionId, output: readAssistantText(messagesResp.data ?? []) };
```

Replace with:

```typescript
    const messagesResp = (await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;

    const firstOutput = readAssistantText(messagesResp.data ?? []);
    const guard = await readAssistantTextWithRetry(
      firstOutput,
      async () => {
        const resp = (await ctx.client.session.messages({
          path: { id: sessionId },
          query: { directory: ctx.directory },
        })) as SessionMessagesResponse;
        return readAssistantText(resp.data ?? []);
      },
      config.subagent.readGuard,
    );

    if (guard.exhausted) {
      throw new Error(buildEmptyReadReason(1 + guard.extraReads));
    }

    return { sessionId, output: guard.output };
```

Rationale for `throw` over enriched-string-as-output:
- Keeps `classify.ts` untouched (constraint).
- The thrown `Error` is caught by the existing `catch (error) { throw createSessionError(error, sessionId); }` and lifted into the standard `classifyThrown` flow (`runAttempt → classifyThrown → classifySpawnError({ thrown, httpStatus: null })`).
- `classifySpawnError` with `thrown` truthy and `assistantText` empty hits `emptyFailure(text="", thrown=true, message="empty assistant output after 3 read attempt(s)")` which returns `{ class: HARD_FAILURE, reason: message }`. The message becomes the user-visible reason — exactly the design's contract.
- The session is cleaned up by the existing `finalizeSettled → cleanupSession` path (HARD_FAILURE branch), so no extra cleanup is needed here.

Do NOT modify `classify.ts`, `retry.ts`, `verifier.ts`, `format.ts`, `generation-fence.ts`, or `registry.ts`.

**Verify:** `bun test tests/tools/spawn-agent/tool.test.ts`
**Commit:** `feat(spawn-agent): defend executeAgentSessionWith against empty assistant reads`

---

### Task 2.2: Wire read-guard into resume-subagent
**File:** `src/tools/resume-subagent.ts` (modify)
**Test:** `tests/tools/resume-subagent.test.ts` (extend)
**Depends:** 1.1, 1.2 (imports `readAssistantTextWithRetry` from 1.1; reads `config.subagent.readGuard` from 1.2)
**Domain:** general

Mirrors Task 2.1 for `resumeSession`. Critical detail confirmed by reading line 143 of `resume-subagent.ts`: the existing `session.messages` call here passes ONLY `{ path: { id: sessionId } }` — no `query: { directory }`. The re-read closure MUST mirror this exactly to avoid behavioural drift.

**Test edits (extend `tests/tools/resume-subagent.test.ts`):**

The existing `buildSession` helper has a `messages` mock that always returns the same canned response. Add a second factory variant and two test cases. Place near the existing helpers (after `buildSession` ends around line 95) and tests inside the existing top-level describe block.

Add helper (insert after `buildSession`):

```typescript
function buildSessionWithMessageSequence(
  recorder: FakeRecorder,
  options: FakeOptions,
  messageOutputs: readonly string[],
) {
  let messageCalls = 0;
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
    messages: async () => {
      const out = messageOutputs[Math.min(messageCalls, messageOutputs.length - 1)];
      messageCalls += 1;
      if (out === "") return { data: [] };
      return {
        data: [
          {
            info: { role: "assistant" as const },
            parts: [{ type: "text", text: out }],
          },
        ],
      };
    },
    delete: async (input: { readonly path: { readonly id: string } }) => {
      recorder.deleteCalls.push(input.path.id);
    },
    update: async (input: { readonly path: { readonly id: string }; readonly body: { readonly title: string } }) => {
      recorder.updateCalls.push({
        id: input.path.id,
        title: input.body.title,
      });
      if (options.updateError) throw options.updateError;
    },
  };
}

function createCtxWithMessageSequence(
  messageOutputs: readonly string[],
): { readonly ctx: PluginInput; readonly recorder: FakeRecorder } {
  const recorder: FakeRecorder = { promptCalls: [], updateCalls: [], deleteCalls: [] };
  const ctx = {
    directory: "/tmp/resume-subagent-test",
    client: { session: buildSessionWithMessageSequence(recorder, {}, messageOutputs) },
  } as unknown as PluginInput;
  return { ctx, recorder };
}
```

Add tests (append inside the existing top-level describe — search for the matching describe block in resume-subagent.test.ts):

```typescript
  it("resume: recovers via read-guard when the first messages read returns empty", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtxWithMessageSequence(["", SUCCESS_OUTPUT]);
    const tool = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(tool, { session_id: SESSION_ID });

    expect(output).toContain(SPAWN_OUTCOMES.SUCCESS);
    expect(output).toContain(SUCCESS_OUTPUT);
    // first read returned [] → guard does at least 1 re-read
    expect(recorder.promptCalls.length).toBe(1);
  });

  it("resume: persistently-empty output produces hard_failure with the read-attempt reason", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx } = createCtxWithMessageSequence([""]);
    const tool = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(tool, { session_id: SESSION_ID });

    expect(output).toContain(SPAWN_OUTCOMES.HARD_FAILURE);
    expect(output).toContain("empty assistant output after");
    expect(output).not.toContain("empty response");
  });
```

**Implementation (modify `src/tools/resume-subagent.ts`):**

Add the import at the top of the imports block:

```typescript
import { readAssistantTextWithRetry } from "./spawn-agent/read-guard";
```

Add the sentinel-message builder near the other constants (after `RESULT_HEADER`):

```typescript
const EMPTY_OUTPUT_REASON_PREFIX = "empty assistant output after";

function buildEmptyReadReason(totalAttempts: number): string {
  return `${EMPTY_OUTPUT_REASON_PREFIX} ${totalAttempts} read attempt(s)`;
}
```

Modify `resumeSession`. Locate the current body:

```typescript
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
```

Replace with:

```typescript
async function resumeSession(ctx: PluginInput, sessionId: string, prompt: string): Promise<Attempt> {
  try {
    await ctx.client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: prompt }] } });
    const response = (await ctx.client.session.messages({ path: { id: sessionId } })) as SessionMessagesResponse;
    const firstOutput = readAssistantText(response.data ?? []);
    const guard = await readAssistantTextWithRetry(
      firstOutput,
      async () => {
        const resp = (await ctx.client.session.messages({ path: { id: sessionId } })) as SessionMessagesResponse;
        return readAssistantText(resp.data ?? []);
      },
      config.subagent.readGuard,
    );

    if (guard.exhausted) {
      const reason = buildEmptyReadReason(1 + guard.extraReads);
      const classification = classifySpawnError({ thrown: new Error(reason), httpStatus: null });
      return { class: classification.class, output: classification.reason };
    }

    const output = guard.output;
    const classification = classifySpawnError({ assistantText: output });
    return { class: classification.class, output: output || classification.reason };
  } catch (error) {
    const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error) });
    return { class: classification.class, output: classification.reason };
  }
}
```

Notes:
- The re-read closure does NOT pass `query: { directory }`, mirroring the existing first-read call (design open question 3, confirmed by inspection of line 143).
- On `exhausted`, we synthesise a thrown classification inline rather than `throw`-ing through the `try/catch`. Both achieve the same `HARD_FAILURE` reason; this style is closer to the existing return-shape of `resumeSession` (`Attempt` is always returned) and keeps the `catch` block reserved for genuine throws from the API client.
- `classifySpawnError({ thrown: new Error(reason), httpStatus: null })` lands in `emptyFailure(text="", thrown=true, message=reason)` → `{ class: HARD_FAILURE, reason }`. Identical user-visible behaviour to Task 2.1.

Do NOT modify `classify.ts`, `format.ts`, `registry.ts`, or any other file.

**Verify:** `bun test tests/tools/resume-subagent.test.ts`
**Commit:** `feat(resume-subagent): defend resumeSession against empty assistant reads`
