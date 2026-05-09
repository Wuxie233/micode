---
date: 2026-05-08
topic: "last-nonempty-subagent-output-extraction"
issue: 59
scope: spawn-agent
contract: none
---

# Last Non-Empty Subagent Output Extraction — Implementation Plan

**Goal:** Replace the `.pop()` "last assistant message" extractor with a reverse-scan that returns the latest **non-empty text-bearing** assistant message, applied consistently to all three call sites (`spawn-agent/tool.ts`, `resume-subagent.ts`, and the verifier in `src/index.ts`), so that a terminal tool-call-only or whitespace-only assistant turn no longer masks real output.

**Architecture:** Land the new logic as a single shared `readAssistantText` exported from `src/tools/spawn-agent/read-guard.ts` (Option A from the design — minimal diff, both subagent files already import this module, and adding the verifier's `src/index.ts` to the import set is a one-line change). Promote `SessionMessage` / `MessagePart` to a shared type re-exported from `read-guard.ts` so the three duplicate local interfaces collapse to one. The #55 read-guard (`readAssistantTextWithRetry`) stays intact and continues to handle the timing-race case; the #59 fix happens **inside** every read attempt (first read and each re-read), so the guard is now invoked only when **every** assistant message is genuinely non-text.

**Design:** [thoughts/shared/designs/2026-05-08-last-nonempty-subagent-output-design.md](../designs/2026-05-08-last-nonempty-subagent-output-design.md)

**Contract:** none (single-domain backend change; no cross-domain API surface)

---

## Notes & Gap-filling Decisions

- **Design Open Question 1 (cardinality):** Single-message return preserved. The reverse-scan returns text from exactly one assistant message (the newest text-bearing one), matching the prior cardinality. No cross-message concatenation.
- **Design Open Question 2 (shared `SessionMessage` type):** I am promoting `SessionMessage` and `MessagePart` to named exports from `read-guard.ts`. Rationale: three identical local interfaces is drift-prone, and the new shared `readAssistantText` accepts `readonly SessionMessage[]` — co-locating the type with its consumer is the cleanest TypeScript shape and removes the need for structural-typing reliance.
- **Design Open Question 3 (debug logging for skipped messages):** Skipping is silent. Adding `log.debug` here would couple `read-guard.ts` to `@/utils/logger` (which it currently does not import). The fix is testable via unit tests; debug logging is out of scope for #59.
- **Design Open Question 4 (generation-fence interaction):** Confirmed by inspection — `evaluateFence` consumes `taskIdentity` derived from prompt + description, never assistant output. No interaction.
- **Design's "verifier — no change" claim, expanded by user's scope reminder:** The design doc states the verifier inherits the fix transparently because `verifier.ts` receives `assistantText` from the spawn path. **However**, the user's scope reminder explicitly calls out "verifier copy in src/index.ts". On inspection, `src/index.ts:519-526` contains a third independent copy of the buggy `readAssistantText` inside `runVerifierClassification` (the marker-verification pipeline) — this copy is **not** fed by the spawn path; it reads its own internal-session messages. It must be fixed for symmetry with the design's stated principle of consistent semantics across all extraction sites. This plan therefore has three call-site modifications, not two.
- **`src/index.ts` does NOT use the read-guard.** `runVerifierClassification` calls the local `readAssistantText` directly with no `readAssistantTextWithRetry` wrapping. We do **not** add a guard here in #59 — that would be scope creep. We only swap the extractor. The verifier session is short-lived and the marker-verification path tolerates an empty result by classifying conservatively; a future issue can decide whether to extend the read-guard to the verifier.

---

## Dependency Graph

```
Batch 1 (parallel - 1 task): 1.1 [foundation - shared helper + types + unit tests, no deps]
Batch 2 (parallel - 3 tasks): 2.1, 2.2, 2.3 [call-site refactor - all depend on 1.1]
Batch 3 (parallel - 2 tasks): 3.1, 3.2     [integration tests - depend on 2.1 / 2.2]
```

---

## Batch 1: Foundation (parallel — 1 implementer)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1

### Task 1.1: Add reverse-scan `readAssistantText` + shared `SessionMessage` types to read-guard
**File:** `src/tools/spawn-agent/read-guard.ts`
**Test:** `tests/tools/spawn-agent/read-guard.test.ts` (extend existing file)
**Depends:** none
**Domain:** backend

This task lands the canonical shared helper. It does NOT touch any caller; callers migrate in Batch 2. Adding the new export alongside the existing `readAssistantTextWithRetry` is non-breaking (existing imports continue to resolve).

**Test additions** (append to `tests/tools/spawn-agent/read-guard.test.ts`, after the existing `describe("readAssistantTextWithRetry", ...)` block):

```typescript
import { readAssistantText, type SessionMessage } from "@/tools/spawn-agent/read-guard";

describe("readAssistantText (reverse-scan)", () => {
  it("returns text when the only assistant message has a text part", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "hello world" }] },
    ];
    expect(readAssistantText(messages)).toBe("hello world");
  });

  it("skips a terminal tool-call-only assistant and returns the prior text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "## Result\nbody" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call", text: undefined }] },
    ];
    expect(readAssistantText(messages)).toBe("## Result\nbody");
  });

  it("skips a terminal whitespace-only assistant and returns the prior text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "real output" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "   \n\t  " }] },
    ];
    expect(readAssistantText(messages)).toBe("real output");
  });

  it("walks past multiple non-text trailing assistants until it finds text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "deep text" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "" }] },
    ];
    expect(readAssistantText(messages)).toBe("deep text");
  });

  it("returns empty string when every assistant message is non-text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "  " }] },
      { info: { role: "assistant" }, parts: [] },
    ];
    expect(readAssistantText(messages)).toBe("");
  });

  it("returns empty string when there are no assistant messages at all", () => {
    const messages: SessionMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
    ];
    expect(readAssistantText(messages)).toBe("");
  });

  it("joins multiple text parts of the chosen assistant with newlines", () => {
    const messages: SessionMessage[] = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "line one" },
          { type: "tool_call" },
          { type: "text", text: "line two" },
        ],
      },
    ];
    expect(readAssistantText(messages)).toBe("line one\nline two");
  });

  it("ignores trailing non-assistant messages while reverse-scanning", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "first" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "user prompt" }] },
    ];
    expect(readAssistantText(messages)).toBe("first");
  });

  it("treats a missing parts array as non-text and skips the message", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "earlier" }] },
      { info: { role: "assistant" } },
    ];
    expect(readAssistantText(messages)).toBe("earlier");
  });
});
```

**Implementation** (add to `src/tools/spawn-agent/read-guard.ts`, ABOVE the existing `ReadGuardOptions` interface so the shared types are declared first; the existing exports stay untouched):

```typescript
export interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

export interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: readonly MessagePart[];
}

export interface SessionMessagesResponse {
  readonly data?: readonly SessionMessage[];
}

/**
 * Returns the concatenated text of the latest assistant message that has at
 * least one non-empty text part, scanning the message list from newest to
 * oldest. Returns "" when no assistant message contains text content.
 *
 * Why reverse-scan instead of `.pop()`:
 *   A subagent can finish with a terminal tool-call-only or whitespace-only
 *   assistant message appended after the real substantive output. Picking the
 *   absolute last assistant message would silently drop the real text. The
 *   read-guard (`readAssistantTextWithRetry`) only fires when this function
 *   returns "", which now happens iff every assistant message is non-text —
 *   the genuine empty-result case.
 */
export function readAssistantText(messages: readonly SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.info?.role !== "assistant") continue;
    const textParts = (message.parts ?? []).filter(
      (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    );
    if (textParts.length > 0) {
      return textParts.map((part) => part.text ?? "").join("\n");
    }
  }
  return "";
}
```

**Notes:**
- The loop walks the **full** message list (not a pre-filtered assistant subarray) and skips non-assistant entries inline. This preserves message ordering with zero allocations on the happy path.
- The text-part predicate trims before checking length so whitespace-only text parts are correctly classified as empty.
- The join uses `"\n"` to match the prior behavior of the duplicated extractors (semantically: when one assistant message has multiple text parts, concatenate them in order).

**Verify:** `bun test tests/tools/spawn-agent/read-guard.test.ts`
**Commit:** `feat(spawn-agent): add reverse-scan readAssistantText to read-guard`

---

## Batch 2: Call-Site Refactor (parallel — 3 implementers)

All tasks in this batch depend on Batch 1 completing (the shared `readAssistantText` and `SessionMessage` exports must exist before any caller can import them).
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Migrate `spawn-agent/tool.ts` to shared `readAssistantText`
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** none (covered by Task 1.1 unit tests for the shared helper and by Task 3.1 integration tests; this task is a pure import/delete refactor with no behavioral risk beyond what the shared helper already verifies)
**Depends:** 1.1 (imports the new export)
**Domain:** backend

**Concrete edits:**

1. **Update the import block** (currently line 23):

   Change:
   ```typescript
   import { readAssistantTextWithRetry } from "./read-guard";
   ```
   to:
   ```typescript
   import {
     type MessagePart,
     readAssistantText,
     readAssistantTextWithRetry,
     type SessionMessage,
     type SessionMessagesResponse,
   } from "./read-guard";
   ```

2. **Delete the local interface declarations** (currently lines 37-49):

   ```typescript
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
   ```
   These are now imported from `./read-guard`.

3. **Delete the local `readAssistantText` function** (currently lines 246-254):

   ```typescript
   function readAssistantText(messages: readonly SessionMessage[]): string {
     const lastAssistant = messages.filter((message) => message.info?.role === "assistant").pop();
     return (
       lastAssistant?.parts
         ?.filter((part) => part.type === "text" && part.text)
         .map((part) => part.text)
         .join("\n") ?? ""
     );
   }
   ```
   The shared import replaces it. All call sites (`readSessionAssistantText` at line 294) continue to call `readAssistantText(...)` with the same signature.

4. **MessagePart import side-effect:** if `MessagePart` is not referenced elsewhere in `tool.ts` after the deletion, the named import for `MessagePart` may produce an unused-import warning under strict lint rules. If the linter flags it, drop `MessagePart` from the named import — the file only needs `SessionMessage`, `SessionMessagesResponse`, `readAssistantText`, and `readAssistantTextWithRetry`. Keep `MessagePart` only if a future consumer in the same file needs it. Default: omit `MessagePart` from the import unless lint requires otherwise.

**No other changes.** The `readGuardedAssistantOutput` flow (lines 297-306), `executeAgentSessionWith` (308-339), `classifySpawnError` calls, and verifier integration remain bit-identical.

**Verify:**
```sh
bun test tests/tools/spawn-agent/tool.test.ts
bun run typecheck   # or `bun run tsc --noEmit` if no script alias exists
```

**Commit:** `refactor(spawn-agent): use shared readAssistantText in spawn-agent tool`

---

### Task 2.2: Migrate `resume-subagent.ts` to shared `readAssistantText`
**File:** `src/tools/resume-subagent.ts`
**Test:** none (covered by Task 1.1 unit tests and Task 3.2 integration tests; pure import/delete refactor)
**Depends:** 1.1
**Domain:** backend

**Concrete edits:**

1. **Update the import block** (currently line 8):

   Change:
   ```typescript
   import { readAssistantTextWithRetry } from "./spawn-agent/read-guard";
   ```
   to:
   ```typescript
   import {
     readAssistantText,
     readAssistantTextWithRetry,
     type SessionMessage,
     type SessionMessagesResponse,
   } from "./spawn-agent/read-guard";
   ```

2. **Delete the local interface declarations** (currently lines 17-29):

   ```typescript
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
   ```
   These are now imported from `./spawn-agent/read-guard`. The local `MessagePart` is no longer referenced anywhere in `resume-subagent.ts` after deletion (it was only used by the local `SessionMessage` interface which is also deleted), so do not re-import it.

3. **Delete the local `readAssistantText` function** (currently lines 71-79):

   ```typescript
   function readAssistantText(messages: readonly SessionMessage[]): string {
     const assistant = messages.filter((message) => message.info?.role === "assistant").pop();
     return (
       assistant?.parts
         ?.filter((part) => part.type === "text" && part.text)
         .map((part) => part.text)
         .join("\n") ?? ""
     );
   }
   ```
   The shared import replaces it. `resumeSession` at lines 150 / 155 continues to call `readAssistantText(...)` unchanged.

**No other changes.** The `EMPTY_OUTPUT_REASON_PREFIX`, `buildEmptyReadReason`, `classifySpawnError` invocation, registry interactions, and resume-prompt construction remain bit-identical.

**Verify:**
```sh
bun test tests/tools/resume-subagent.test.ts
bun run typecheck
```

**Commit:** `refactor(spawn-agent): use shared readAssistantText in resume-subagent`

---

### Task 2.3: Migrate verifier extraction in `src/index.ts` to shared `readAssistantText`
**File:** `src/index.ts`
**Test:** none (covered by Task 1.1 unit tests for the shared helper; the verifier path in `index.ts` has no dedicated unit test today and adding one is out of scope for #59 — the existing `verifier.test.ts` operates on `assistantText` directly and is unaffected)
**Depends:** 1.1
**Domain:** backend

**Rationale (gap-fill, see plan header):** The design doc claims the verifier needs no change because it inherits text from the spawn path. The user's scope reminder explicitly contradicts this for the `src/index.ts` copy, which is correct: `runVerifierClassification` reads its **own** internal-session messages (a fresh session created for marker classification), not the spawn path's session. It must use the same reverse-scan extractor. We are NOT adding a read-guard to this path; the verifier's empty-result behavior is already conservative (the marker-verifier classifies an empty assistant text as inconclusive and falls back to the original spawn outcome).

**Concrete edits:**

1. **Add the shared import.** Locate the existing import group at the top of `src/index.ts` that imports from `./tools/spawn-agent/read-guard` (or the closest neighbor under `./tools/spawn-agent/`). If no `read-guard` import exists yet in `index.ts`, add a new line in the same import region:

   ```typescript
   import {
     readAssistantText,
     type SessionMessage,
     type SessionMessagesResponse,
   } from "./tools/spawn-agent/read-guard";
   ```

   The path prefix (`./tools/spawn-agent/read-guard` vs `@/tools/spawn-agent/read-guard`) MUST match the import-path convention used by other `./tools/spawn-agent/...` imports already in `src/index.ts`. Inspect the existing imports and copy that style verbatim — do not introduce a new alias style in this file.

2. **Delete the local interface declarations** (currently around lines 436-448):

   ```typescript
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
   ```

   The shared import replaces `SessionMessage` and `SessionMessagesResponse`. `MessagePart` is unreferenced after the deletion — do not re-import it. If a static analyzer reports `MessagePart` as referenced elsewhere in `index.ts`, add it to the named import; otherwise omit.

3. **Delete the local `readAssistantText` function** (currently lines 519-526):

   ```typescript
   function readAssistantText(messages: readonly SessionMessage[]): string {
     const assistant = messages.filter((message) => message.info?.role === "assistant").pop();
     return (
       assistant?.parts
         ?.filter((part) => part.type === "text" && part.text)
         .map((part) => part.text)
         .join("\n") ?? ""
     );
   }
   ```

   The call site inside `runVerifierClassification` (currently around line 550, `return readAssistantText(response.data ?? []);`) continues to call `readAssistantText(...)` unchanged — it now resolves to the shared import.

**No other changes.** `runVerifierClassification`, `buildVerifierPromptBody`, `buildRealVerifier`, the marker-verifier wiring, and every other code path in `index.ts` stay bit-identical.

**Verify:**
```sh
bun run typecheck
bun test tests/tools/spawn-agent/verifier.test.ts
bun test tests/tools/spawn-agent/classify-verifier-integration.test.ts
```

The two verifier-related test files are existing regression coverage — they must pass unchanged.

**Commit:** `refactor(verifier): use shared readAssistantText in marker-verifier classifier`

---

## Batch 3: Integration Tests (parallel — 2 implementers)

All tasks in this batch depend on Batch 2 completing (each integration test asserts behavior of a refactored call site).
Tasks: 3.1, 3.2

### Task 3.1: Integration test — spawn-agent recovers from terminal empty assistant
**File:** `tests/tools/spawn-agent/tool.test.ts`
**Test:** this IS a test file extension; the work is the test additions themselves
**Depends:** 2.1 (the migrated `tool.ts` must be in place; Batch 1's helper alone is not enough — this asserts end-to-end through `executeAgentSessionWith` → `readGuardedAssistantOutput` → shared `readAssistantText`)
**Domain:** backend

**What this verifies:** The spawn flow produces `outcome === "success"` (not `hard_failure`) and `output` equal to the real text when the **last** assistant message in the session is tool-call-only or whitespace-only and a **prior** assistant message contains the real text. Critically, this must succeed with `extraReads === 0` (the read-guard does NOT fire), proving the fix happens before the guard.

**Test additions** (append inside the existing top-level `describe(...)` for `createSpawnAgentTool` in `tests/tools/spawn-agent/tool.test.ts`; reuse the existing `SESSION_ID`, `DIRECTORY`, `AGENT`, `PROMPT`, `DESCRIPTION`, `TASK`, `createRegistry`, `createSpawnRegistry`, and the existing `createSpawnAgentTool` invocation pattern from earlier tests in the same file):

```typescript
function createCtxWithTrailingToolCall(realText: string): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const update = mock(async () => ({}));
  const deleteSession = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: realText }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_call" }],
      },
    ],
  }));
  return {
    client: { session: { create, prompt, messages, update, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}

function createCtxWithTrailingWhitespace(realText: string): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const update = mock(async () => ({}));
  const deleteSession = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: realText }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "   \n  " }],
      },
    ],
  }));
  return {
    client: { session: { create, prompt, messages, update, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}

describe("spawn-agent reverse-scan extraction (issue #59)", () => {
  it("returns success with the prior assistant text when the last assistant is tool-call-only", async () => {
    const ctx = createCtxWithTrailingToolCall(SUCCESS_OUTPUT);
    const tool = createSpawnAgentTool(ctx, {
      preservedRegistry: createRegistry(),
      spawnSessionRegistry: createSpawnRegistry(),
    });
    const result = await tool.execute({ agents: [TASK] }, { sessionID: PARENT_SESSION_ID } as never);
    // The result is markdown produced by formatSpawnResults; verify the outcome and the real text appear.
    expect(result).toContain(SPAWN_OUTCOMES.SUCCESS);
    expect(result).toContain(SUCCESS_OUTPUT);
    // The messages mock returns the same payload on every call. If the read-guard had fired, it would
    // have called messages() again; assert exactly one messages() invocation per spawn (the first read).
    expect(ctx.client.session.messages).toHaveBeenCalledTimes(1);
  });

  it("returns success with the prior assistant text when the last assistant is whitespace-only", async () => {
    const ctx = createCtxWithTrailingWhitespace(SUCCESS_OUTPUT);
    const tool = createSpawnAgentTool(ctx, {
      preservedRegistry: createRegistry(),
      spawnSessionRegistry: createSpawnRegistry(),
    });
    const result = await tool.execute({ agents: [TASK] }, { sessionID: PARENT_SESSION_ID } as never);
    expect(result).toContain(SPAWN_OUTCOMES.SUCCESS);
    expect(result).toContain(SUCCESS_OUTPUT);
    expect(ctx.client.session.messages).toHaveBeenCalledTimes(1);
  });

  it("still triggers the read-guard when ALL assistant messages are non-text (regression for #55)", async () => {
    // Every read returns a single tool-call-only assistant — the reverse-scan exhausts and returns "",
    // which is the input the read-guard expects. After config.subagent.readGuard.maxExtraReads
    // re-reads, the spawn must classify as a hard_failure with the empty-output reason.
    const create = mock(async () => ({ data: { id: SESSION_ID } }));
    const prompt = mock(async () => ({}));
    const update = mock(async () => ({}));
    const deleteSession = mock(async () => ({}));
    const messages = mock(async () => ({
      data: [
        {
          info: { role: "assistant" },
          parts: [{ type: "tool_call" }],
        },
      ],
    }));
    const ctx = {
      client: { session: { create, prompt, messages, update, delete: deleteSession } },
      directory: DIRECTORY,
    } as never;
    const tool = createSpawnAgentTool(ctx, {
      preservedRegistry: createRegistry(),
      spawnSessionRegistry: createSpawnRegistry(),
    });
    const result = await tool.execute({ agents: [TASK] }, { sessionID: PARENT_SESSION_ID } as never);
    expect(result).toContain(SPAWN_OUTCOMES.HARD_FAILURE);
    // 1 first read + N re-reads from the guard
    expect((messages as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(1);
  });
});
```

**Notes for the implementer:**
- The third test asserts the **#55 read-guard fallback is preserved**. If `messages()` is called only once when every assistant is non-text, the guard has been bypassed — that is a regression. The test counts calls via the bun-mock `mock` helper.
- If `createSpawnAgentTool`'s call shape differs from `(args, ctx)` in your local file, mirror the exact shape used by neighboring tests in the same file (e.g. existing `await tool.execute({ agents: [TASK] }, { sessionID: PARENT_SESSION_ID } as never)`). Do not invent a new invocation pattern — copy the closest existing test's call shape verbatim.
- `SPAWN_OUTCOMES` is already imported at the top of the file. `PARENT_SESSION_ID` and `SUCCESS_OUTPUT` are already defined as module constants.
- Do NOT modify any existing test in this file. Append-only.

**Verify:** `bun test tests/tools/spawn-agent/tool.test.ts`
**Commit:** `test(spawn-agent): cover terminal empty/tool-call assistant message`

---

### Task 3.2: Integration test — resume-subagent recovers from terminal empty assistant
**File:** `tests/tools/resume-subagent.test.ts`
**Test:** this IS a test file extension; the work is the test additions themselves
**Depends:** 2.2
**Domain:** backend

**What this verifies:** `runResume` (via `resumeSession`) produces `outcome === "success"` and `output` containing the real text when the **last** assistant message of the resumed session is tool-call-only or whitespace-only. The existing `buildSession` helper must be extended to support a multi-message payload (today it returns a single assistant message); the new helper is local to the new tests and does not modify the existing `buildSession`.

**Test additions** (append inside the top-level `describe(...)` for `createResumeSubagentTool` in `tests/tools/resume-subagent.test.ts`; reuse the existing `SESSION_ID`, `AGENT`, `DESCRIPTION`, `SUCCESS_OUTPUT`, `TTL_HOURS`, `createRegistry`, `preserveSession`, and `createResumeSubagentTool` invocation pattern from neighboring tests):

```typescript
interface MultiMessageOptions {
  readonly messages: readonly {
    readonly role: "user" | "assistant";
    readonly parts: readonly { readonly type: string; readonly text?: string }[];
  }[];
}

function buildMultiMessageSession(recorder: FakeRecorder, options: MultiMessageOptions) {
  return {
    prompt: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly parts: readonly { readonly text: string }[] };
    }) => {
      recorder.promptCalls.push({
        id: input.path.id,
        text: input.body.parts[0]?.text ?? "",
      });
    },
    messages: async (input: unknown) => {
      recorder.messagesCalls.push(input);
      return {
        data: options.messages.map((m) => ({
          info: { role: m.role },
          parts: m.parts,
        })),
      };
    },
    delete: async (input: { readonly path: { readonly id: string } }) => {
      recorder.deleteCalls.push(input.path.id);
    },
    update: async (input: { readonly path: { readonly id: string }; readonly body: { readonly title: string } }) => {
      recorder.updateCalls.push({ id: input.path.id, title: input.body.title });
    },
  };
}

describe("resume-subagent reverse-scan extraction (issue #59)", () => {
  it("returns success with the prior assistant text when the last assistant is tool-call-only", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const recorder: FakeRecorder = {
      promptCalls: [],
      messagesCalls: [],
      updateCalls: [],
      deleteCalls: [],
    };
    const ctx = {
      client: {
        session: buildMultiMessageSession(recorder, {
          messages: [
            { role: "assistant", parts: [{ type: "text", text: SUCCESS_OUTPUT }] },
            { role: "assistant", parts: [{ type: "tool_call" }] },
          ],
        }),
      },
      directory: "/tmp/resume",
    } as unknown as PluginInput;
    const tool = createResumeSubagentTool(ctx, { registry });
    const execute = tool.execute as unknown as ExecuteSignature;
    const output = await execute({ session_id: SESSION_ID }, {} as never);
    expect(output).toContain(`**Outcome**: ${SPAWN_OUTCOMES.SUCCESS}`);
    expect(output).toContain(SUCCESS_OUTPUT);
    // First read produced non-empty via reverse-scan; guard must not have re-read.
    expect(recorder.messagesCalls.length).toBe(1);
  });

  it("returns success with the prior assistant text when the last assistant is whitespace-only", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const recorder: FakeRecorder = {
      promptCalls: [],
      messagesCalls: [],
      updateCalls: [],
      deleteCalls: [],
    };
    const ctx = {
      client: {
        session: buildMultiMessageSession(recorder, {
          messages: [
            { role: "assistant", parts: [{ type: "text", text: SUCCESS_OUTPUT }] },
            { role: "assistant", parts: [{ type: "text", text: "   \n  " }] },
          ],
        }),
      },
      directory: "/tmp/resume",
    } as unknown as PluginInput;
    const tool = createResumeSubagentTool(ctx, { registry });
    const execute = tool.execute as unknown as ExecuteSignature;
    const output = await execute({ session_id: SESSION_ID }, {} as never);
    expect(output).toContain(`**Outcome**: ${SPAWN_OUTCOMES.SUCCESS}`);
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(recorder.messagesCalls.length).toBe(1);
  });
});
```

**Notes for the implementer:**
- `FakeRecorder` and `ExecuteSignature` are already declared near the top of the existing test file (visible in the first 100 lines); reuse them rather than redeclaring.
- `buildMultiMessageSession` is a NEW local helper — do not collide with the existing `buildSession` (which is single-message). Both helpers coexist.
- Do NOT modify the existing `buildSession` or any existing test. Append-only.
- The third assertion (`recorder.messagesCalls.length === 1`) proves the read-guard did not fire, which is the evidence that the fix sits inside `readAssistantText`, not inside `readAssistantTextWithRetry`. This matches the design's contract that the #55 guard is preserved as a true-empty fallback only.

**Verify:** `bun test tests/tools/resume-subagent.test.ts`
**Commit:** `test(resume-subagent): cover terminal empty/tool-call assistant message`
