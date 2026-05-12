---
date: 2026-05-12
topic: "Octto batched auto-resume and model inheritance"
issue: 65
scope: octto
contract: none
---

# Octto Batched Auto-Resume and Model Inheritance Implementation Plan

**Goal:** Coalesce a burst of Octto answer events into one continuation prompt per owner OpenCode session, and include the owner conversation's last-used model in that prompt when it can be read from session message metadata.

**Architecture:** Keep the existing layers (Octto UI / session store / dispatcher / client adapter) intact. Add a small batch queue keyed by `ownerSessionId` inside the dispatcher with a short quiet window (200 ms) and an injectable scheduler. Add a model lookup helper that reads `client.session.messages` and returns the most recent assistant message's `info.providerID`/`info.modelID` as a `ModelReference`, swallowing all errors. Extend `ClientPromptRequest` with an optional `body.model`. Update the `index.ts` adapter so `client.session.prompt` receives the model when present.

**Design:** `thoughts/shared/designs/2026-05-12-octto-batched-auto-resume-model-inheritance-design.md`

**Contract:** none (single-domain — all tasks are `backend` or `general`; no frontend tasks involved)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - scheduler abstraction + model resolver - no deps]
Batch 2 (parallel): 2.1, 2.2 [prompt template + dispatcher rewrite - depends on batch 1]
Batch 3 (sequential): 3.1 [index.ts wiring - depends on batch 2]
Batch 4 (parallel): 4.1, 4.2 [integration + regression tests - depends on batch 3]
```

Notes on dependencies:

- `1.1` (scheduler) and `1.2` (model resolver) are independent new files.
- `2.1` (prompt) and `2.2` (dispatcher) both import from `1.1` and `1.2`, but they do not import each other.
- `3.1` wires everything together in `src/index.ts`, so it must run after `2.2` exports the new dispatcher input shape.
- Batch 4 tests exercise the wired-up surface, so they must run after `3.1`.

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Scheduler abstraction for the dispatcher batch timer
**File:** `src/octto/auto-resume/scheduler.ts`
**Test:** `tests/octto/auto-resume/scheduler.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Rationale: The design's Open Question explicitly calls out "tests show timer flakiness, planner may choose a dependency-injected scheduler or explicit flush helper for deterministic coverage." I'm choosing the dependency-injected scheduler approach so dispatcher unit tests can use a fake clock without polling `setTimeout`. This file owns the scheduler interface and a default `setTimeout`-backed implementation.

```typescript
// tests/octto/auto-resume/scheduler.test.ts
import { describe, expect, it } from "bun:test";

import { createDefaultScheduler, type Scheduler } from "../../../src/octto/auto-resume/scheduler";

describe("default scheduler", () => {
  it("invokes the callback after the requested delay", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = false;

    const handle = scheduler.schedule(() => {
      fired = true;
    }, 10);

    expect(typeof handle.cancel).toBe("function");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(true);
  });

  it("cancel prevents a pending callback from firing", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = false;

    const handle = scheduler.schedule(() => {
      fired = true;
    }, 10);
    handle.cancel();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(false);
  });

  it("cancel after fire is a no-op", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = 0;

    const handle = scheduler.schedule(() => {
      fired += 1;
    }, 5);

    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.cancel();
    expect(fired).toBe(1);
  });
});
```

```typescript
// src/octto/auto-resume/scheduler.ts
export interface ScheduledHandle {
  readonly cancel: () => void;
}

export interface Scheduler {
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledHandle;
}

export function createDefaultScheduler(): Scheduler {
  return {
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      const releasable = timer as unknown as { readonly unref?: () => void };
      releasable.unref?.();
      return {
        cancel: () => {
          clearTimeout(timer);
        },
      };
    },
  };
}
```

**Verify:** `bun test tests/octto/auto-resume/scheduler.test.ts`
**Commit:** `feat(octto): add scheduler abstraction for auto-resume batching`

### Task 1.2: Owner-session model lookup helper
**File:** `src/octto/auto-resume/model-lookup.ts`
**Test:** `tests/octto/auto-resume/model-lookup.test.ts`
**Depends:** none
**Domain:** backend
**Atlas-impact:** none

Rationale: Design says "Model lookup helper: Queries the owner OpenCode session messages and extracts the most recent usable model metadata, prioritizing assistant messages." The existing `info` shape (`providerID`, `modelID`) is already used by `src/hooks/auto-compact.ts`. We return a `ModelReference` so the prompt body can reuse the same type used elsewhere (`src/utils/model-selection.ts`). All errors are swallowed per the design's best-effort constraint.

```typescript
// tests/octto/auto-resume/model-lookup.test.ts
import { describe, expect, it } from "bun:test";

import {
  createOwnerModelLookup,
  type OwnerModelClient,
  type SessionMessageWithInfo,
} from "../../../src/octto/auto-resume/model-lookup";

const OWNER_SESSION_ID = "owner-session-1";

function createClient(messages: readonly SessionMessageWithInfo[]): OwnerModelClient {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  };
}

describe("createOwnerModelLookup", () => {
  it("returns the most recent assistant message's provider and model", async () => {
    const client = createClient([
      { info: { role: "assistant", providerID: "anthropic", modelID: "claude-old" } },
      { info: { role: "user" } },
      { info: { role: "assistant", providerID: "wuxie-claude", modelID: "claude-opus-4-7" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toEqual({ providerID: "wuxie-claude", modelID: "claude-opus-4-7" });
  });

  it("ignores user messages and only inspects assistant info", async () => {
    const client = createClient([
      { info: { role: "user", providerID: "anthropic", modelID: "claude-user" } },
      { info: { role: "assistant", providerID: "openai", modelID: "gpt-5" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5" });
  });

  it("returns null when no assistant message carries provider and model", async () => {
    const client = createClient([
      { info: { role: "user" } },
      { info: { role: "assistant" } },
      { info: { role: "assistant", providerID: "anthropic" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("returns null when the response has no messages", async () => {
    const client = createClient([]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("swallows client errors and returns null", async () => {
    const failingClient: OwnerModelClient = {
      session: {
        messages: async () => {
          throw new Error("network error");
        },
      },
    };
    const lookup = createOwnerModelLookup({ client: failingClient });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("returns null when the data field is undefined", async () => {
    const client: OwnerModelClient = {
      session: {
        messages: async () => ({}),
      },
    };
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });
});
```

```typescript
// src/octto/auto-resume/model-lookup.ts
import type { ModelReference } from "@/utils/model-selection";

export interface SessionMessageInfo {
  readonly role?: "user" | "assistant";
  readonly providerID?: string;
  readonly modelID?: string;
}

export interface SessionMessageWithInfo {
  readonly info?: SessionMessageInfo;
}

export interface SessionMessagesResult {
  readonly data?: readonly SessionMessageWithInfo[];
}

export interface OwnerModelClient {
  readonly session: {
    readonly messages: (request: { readonly path: { readonly id: string } }) => Promise<SessionMessagesResult>;
  };
}

export interface OwnerModelLookup {
  readonly resolve: (ownerSessionId: string) => Promise<ModelReference | null>;
}

interface OwnerModelLookupInput {
  readonly client: OwnerModelClient;
}

function extractModelReference(messages: readonly SessionMessageWithInfo[]): ModelReference | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") continue;
    const providerID = info.providerID;
    const modelID = info.modelID;
    if (typeof providerID === "string" && providerID.length > 0 && typeof modelID === "string" && modelID.length > 0) {
      return { providerID, modelID };
    }
  }
  return null;
}

export function createOwnerModelLookup(input: OwnerModelLookupInput): OwnerModelLookup {
  return {
    resolve: async (ownerSessionId) => {
      try {
        const response = await input.client.session.messages({ path: { id: ownerSessionId } });
        const messages = response.data ?? [];
        return extractModelReference(messages);
      } catch {
        return null;
      }
    },
  };
}
```

**Verify:** `bun test tests/octto/auto-resume/model-lookup.test.ts`
**Commit:** `feat(octto): add owner-session model lookup for auto-resume`

---

## Batch 2: Core Modules (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Update continue-prompt template for batched answers
**File:** `src/octto/auto-resume/prompt.ts`
**Test:** `tests/octto/auto-resume/prompt.test.ts`
**Depends:** none (does not import from Batch 1, but kept in Batch 2 so the dispatcher in 2.2 can reuse the new signature without circular planning)
**Domain:** general
**Atlas-impact:** none

Rationale: The existing prompt embeds a single `question_id`. The design says the new prompt "tells the agent how many answers are ready and instructs it to drain available answers through Octto tools." I'm switching the input shape to `{conversationId, questionIds}` so the prompt builder owns the singular/plural wording. The Octto answer retrieval contract is preserved: the prompt still tells the agent to call `get_next_answer({session_id: "..."})`, it never inlines the answers.

The existing prompt-build test file is replaced wholesale because the contract changes from "one question id" to "one or more question ids". The wording for a single answer stays byte-identical to today's template so the integration test in `tests/integration/octto-auto-resume.test.ts` keeps passing without modification.

```typescript
// tests/octto/auto-resume/prompt.test.ts
import { describe, expect, it } from "bun:test";

import { buildContinuePrompt } from "../../../src/octto/auto-resume/prompt";

const SINGLE_ANSWER_PROMPT =
  '你之前的会话有用户回答到达 (question_id=question-1)。请调用 `get_next_answer({session_id: "conversation-1"})` 取出答案,然后继续原任务。';

describe("auto-resume continue prompt", () => {
  it("uses the singular wording when exactly one question id is provided", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionIds: ["question-1"] });

    expect(prompt).toBe(SINGLE_ANSWER_PROMPT);
  });

  it("uses a count-based wording when multiple question ids are provided", () => {
    const prompt = buildContinuePrompt({
      conversationId: "conversation-1",
      questionIds: ["question-1", "question-2", "question-3"],
    });

    expect(prompt).toBe(
      '你之前的会话有 3 个用户回答到达 (question_ids=question-1, question-2, question-3)。请反复调用 `get_next_answer({session_id: "conversation-1"})` 取出全部答案,然后继续原任务。',
    );
  });

  it("removes template placeholders", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionIds: ["question-1"] });

    expect(prompt).not.toContain("{conversationId}");
    expect(prompt).not.toContain("{questionId}");
    expect(prompt).not.toContain("{questionIds}");
    expect(prompt).not.toContain("{count}");
  });

  it("does not throw for empty conversation id and empty question id list", () => {
    expect(() => buildContinuePrompt({ conversationId: "", questionIds: [] })).not.toThrow();
  });

  it("falls back to the singular template when given an empty question id list", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionIds: [] });

    expect(prompt).toContain('get_next_answer({session_id: "conversation-1"})');
  });
});
```

```typescript
// src/octto/auto-resume/prompt.ts
const SINGLE_TEMPLATE =
  '你之前的会话有用户回答到达 (question_id={questionId})。请调用 `get_next_answer({session_id: "{conversationId}"})` 取出答案,然后继续原任务。';

const MULTI_TEMPLATE =
  '你之前的会话有 {count} 个用户回答到达 (question_ids={questionIds})。请反复调用 `get_next_answer({session_id: "{conversationId}"})` 取出全部答案,然后继续原任务。';

const SINGLE_ANSWER_COUNT = 1;

export interface BuildContinuePromptInput {
  readonly conversationId: string;
  readonly questionIds: readonly string[];
}

function buildSingle(conversationId: string, questionId: string): string {
  return SINGLE_TEMPLATE.replace("{questionId}", questionId).replace("{conversationId}", conversationId);
}

function buildMulti(conversationId: string, questionIds: readonly string[]): string {
  return MULTI_TEMPLATE.replace("{count}", String(questionIds.length))
    .replace("{questionIds}", questionIds.join(", "))
    .replace("{conversationId}", conversationId);
}

export function buildContinuePrompt(input: BuildContinuePromptInput): string {
  const { conversationId, questionIds } = input;
  if (questionIds.length <= SINGLE_ANSWER_COUNT) {
    const questionId = questionIds[0] ?? "";
    return buildSingle(conversationId, questionId);
  }
  return buildMulti(conversationId, questionIds);
}
```

**Verify:** `bun test tests/octto/auto-resume/prompt.test.ts`
**Commit:** `feat(octto): support batched question ids in auto-resume prompt`

### Task 2.2: Rewrite dispatcher with batch queue and model inheritance
**File:** `src/octto/auto-resume/dispatcher.ts`
**Test:** `tests/octto/auto-resume/dispatcher.test.ts`
**Depends:** 1.1, 1.2, 2.1 (imports scheduler, model lookup, and the new prompt signature)
**Domain:** backend
**Atlas-impact:** none

Rationale: Design says "the dispatcher groups them and sends exactly one continuation prompt after a short quiet window." Implementation choices:

- Quiet window: 200 ms (design open question). Exposed as `quietWindowMs` input with a default so tests inject `0` and a controlled fake scheduler.
- Batching key: `ownerSessionId`. All events for the same owner coalesce regardless of which Octto conversation they came from. Each batch tracks one conversation id (the first event's) and a deduplicated ordered list of question ids. If events for two different Octto conversations land in the same burst against the same owner — not a current scenario, but defensible — the batch fires once for the first conversation; subsequent answers from the second conversation start a fresh batch after flush. This matches the design's "tracks pending answered question IDs per Octto session and owner session" while keeping the flush-fires-once invariant simple.
- Flush: cancels the pending timer, snapshots and clears the pending state, then awaits model lookup (best-effort, swallowed), then sends one prompt. If `client.session.prompt` rejects, log a warning identical to today's `DISPATCH_WARNING` to keep the existing test assertion stable.
- `ClientPromptRequest.body.model`: new optional field of type `ModelReference`. The dispatcher emits it only when the lookup resolves successfully. Backward compatibility with the existing single-text-part adapter is preserved because `model` is optional.

```typescript
// tests/octto/auto-resume/dispatcher.test.ts
import { describe, expect, it } from "bun:test";

import {
  type AutoResumeEvent,
  type ClientPromptRequest,
  createAutoResumeDispatcher,
} from "../../../src/octto/auto-resume/dispatcher";
import type { OwnerModelLookup } from "../../../src/octto/auto-resume/model-lookup";
import { buildContinuePrompt } from "../../../src/octto/auto-resume/prompt";
import { createAutoResumeRegistry } from "../../../src/octto/auto-resume/registry";
import type { Scheduler, ScheduledHandle } from "../../../src/octto/auto-resume/scheduler";

const CONVERSATION_ID = "conversation-1";
const OWNER_SESSION_ID = "owner-session-1";
const QUESTION_ID_A = "question-a";
const QUESTION_ID_B = "question-b";
const ANSWERED_AT = 1_774_220_000_000;
const QUIET_WINDOW_MS = 0;
const WARNING = "[octto.auto-resume] Failed to dispatch auto-resume prompt: prompt failed";

interface ManualScheduler extends Scheduler {
  readonly flush: () => Promise<void>;
  readonly pending: () => number;
}

function createManualScheduler(): ManualScheduler {
  const callbacks: Array<() => void> = [];
  return {
    schedule: (callback) => {
      callbacks.push(callback);
      const handle: ScheduledHandle = {
        cancel: () => {
          const index = callbacks.indexOf(callback);
          if (index >= 0) callbacks.splice(index, 1);
        },
      };
      return handle;
    },
    flush: async () => {
      const pending = callbacks.splice(0, callbacks.length);
      for (const cb of pending) cb();
      await Promise.resolve();
    },
    pending: () => callbacks.length,
  };
}

interface RecordedClient {
  readonly calls: ClientPromptRequest[];
  readonly session: { readonly prompt: (request: ClientPromptRequest) => Promise<void> };
}

function createRecordedClient(): RecordedClient {
  const calls: ClientPromptRequest[] = [];
  return {
    calls,
    session: {
      prompt: async (request) => {
        calls.push(request);
      },
    },
  };
}

function createNullLookup(): OwnerModelLookup {
  return { resolve: async () => null };
}

function createFixedLookup(provider: string, model: string): OwnerModelLookup {
  return { resolve: async () => ({ providerID: provider, modelID: model }) };
}

function buildEvent(questionId: string): AutoResumeEvent {
  return {
    conversationId: CONVERSATION_ID,
    ownerSessionId: OWNER_SESSION_ID,
    questionId,
    answeredAt: ANSWERED_AT,
  };
}

async function captureWarnings(callback: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await callback();
  } finally {
    console.warn = original;
  }
  return warnings;
}

describe("auto-resume dispatcher", () => {
  it("collapses a burst of answer events into a single prompt", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await dispatcher.handle(buildEvent(QUESTION_ID_B));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toEqual({ id: OWNER_SESSION_ID });
    expect(client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: CONVERSATION_ID, questionIds: [QUESTION_ID_A, QUESTION_ID_B] }),
    );
    expect(client.calls[0]?.body.model).toBeUndefined();
  });

  it("still sends one prompt for a single answer event", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: CONVERSATION_ID, questionIds: [QUESTION_ID_A] }),
    );
  });

  it("does not merge events separated by a flush boundary", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    await dispatcher.handle(buildEvent(QUESTION_ID_B));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.body.parts[0]?.text).toContain(QUESTION_ID_A);
    expect(client.calls[1]?.body.parts[0]?.text).toContain(QUESTION_ID_B);
  });

  it("includes the resolved model reference in the prompt body when available", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createFixedLookup("wuxie-claude", "claude-opus-4-7"),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls[0]?.body.model).toEqual({ providerID: "wuxie-claude", modelID: "claude-opus-4-7" });
  });

  it("omits the model field when the lookup returns null", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls[0]?.body.model).toBeUndefined();
  });

  it("skips dispatch when no owner session is registered", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls).toEqual([]);
    expect(scheduler.pending()).toBe(0);
  });

  it("swallows client prompt failures after logging a warning", async () => {
    const calls: ClientPromptRequest[] = [];
    const client = {
      session: {
        prompt: async (request: ClientPromptRequest) => {
          calls.push(request);
          throw new Error("prompt failed");
        },
      },
    };
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    const warnings = await captureWarnings(async () => {
      await dispatcher.handle(buildEvent(QUESTION_ID_A));
      await scheduler.flush();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([WARNING]);
  });

  it("deduplicates repeated question ids within the same batch", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt: buildContinuePrompt,
      scheduler,
      modelLookup: createNullLookup(),
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await dispatcher.handle(buildEvent(QUESTION_ID_A));
    await scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: CONVERSATION_ID, questionIds: [QUESTION_ID_A] }),
    );
  });
});
```

```typescript
// src/octto/auto-resume/dispatcher.ts
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ModelReference } from "@/utils/model-selection";
import type { OwnerModelLookup } from "./model-lookup";
import type { buildContinuePrompt } from "./prompt";
import type { AutoResumeRegistry } from "./registry";
import { createDefaultScheduler, type ScheduledHandle, type Scheduler } from "./scheduler";

export interface AutoResumeEvent {
  readonly conversationId: string;
  readonly ownerSessionId: string;
  readonly questionId: string;
  readonly answeredAt: number;
}

export interface ClientPromptRequest {
  readonly path: {
    readonly id: string;
  };
  readonly body: {
    readonly parts: readonly [
      {
        readonly type: "text";
        readonly text: string;
      },
    ];
    readonly model?: ModelReference;
  };
}

export interface AutoResumeDispatcher {
  readonly handle: (event: AutoResumeEvent) => Promise<void>;
}

interface AutoResumeClient {
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<unknown>;
  };
}

interface AutoResumeDispatcherInput {
  readonly client: AutoResumeClient;
  readonly registry: AutoResumeRegistry;
  readonly buildPrompt: typeof buildContinuePrompt;
  readonly modelLookup: OwnerModelLookup;
  readonly scheduler?: Scheduler;
  readonly quietWindowMs?: number;
}

interface PendingBatch {
  readonly conversationId: string;
  readonly ownerSessionId: string;
  readonly questionIds: string[];
  handle: ScheduledHandle | null;
}

const LOG_SCOPE = "octto.auto-resume";
const DISPATCH_WARNING = "Failed to dispatch auto-resume prompt";
const DEFAULT_QUIET_WINDOW_MS = 200;

function buildBodyParts(text: string): readonly [{ readonly type: "text"; readonly text: string }] {
  return [{ type: "text", text }];
}

function buildRequest(
  ownerSessionId: string,
  text: string,
  model: ModelReference | null,
): ClientPromptRequest {
  const parts = buildBodyParts(text);
  if (model) {
    return { path: { id: ownerSessionId }, body: { parts, model } };
  }
  return { path: { id: ownerSessionId }, body: { parts } };
}

function appendQuestionId(batch: PendingBatch, questionId: string): void {
  if (!batch.questionIds.includes(questionId)) {
    batch.questionIds.push(questionId);
  }
}

export function createAutoResumeDispatcher(input: AutoResumeDispatcherInput): AutoResumeDispatcher {
  const scheduler = input.scheduler ?? createDefaultScheduler();
  const quietWindowMs = input.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const pending = new Map<string, PendingBatch>();

  async function flush(ownerSessionId: string): Promise<void> {
    const batch = pending.get(ownerSessionId);
    if (!batch) return;
    pending.delete(ownerSessionId);
    batch.handle = null;

    try {
      const model = await input.modelLookup.resolve(ownerSessionId);
      const text = input.buildPrompt({
        conversationId: batch.conversationId,
        questionIds: batch.questionIds,
      });
      await input.client.session.prompt(buildRequest(ownerSessionId, text, model));
    } catch (error: unknown) {
      log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
    }
  }

  function scheduleFlush(ownerSessionId: string): void {
    const batch = pending.get(ownerSessionId);
    if (!batch) return;
    batch.handle?.cancel();
    batch.handle = scheduler.schedule(() => {
      void flush(ownerSessionId);
    }, quietWindowMs);
  }

  async function handle(event: AutoResumeEvent): Promise<void> {
    const ownerSessionId = input.registry.lookup(event.conversationId);
    if (!ownerSessionId) return;

    const existing = pending.get(event.ownerSessionId);
    if (existing) {
      appendQuestionId(existing, event.questionId);
    } else {
      pending.set(event.ownerSessionId, {
        conversationId: event.conversationId,
        ownerSessionId: event.ownerSessionId,
        questionIds: [event.questionId],
        handle: null,
      });
    }
    scheduleFlush(event.ownerSessionId);
  }

  return { handle };
}
```

**Verify:** `bun test tests/octto/auto-resume/dispatcher.test.ts`
**Commit:** `feat(octto): batch auto-resume events and inherit owner model`

---

## Batch 3: Wiring (sequential - 1 implementer)

This batch depends on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Wire dispatcher with model lookup and pass model to client.session.prompt
**File:** `src/index.ts`
**Test:** none (single-call wiring change; new behavior is exercised by Task 4.1 integration test and Task 4.2 regression)
**Depends:** 1.1, 1.2, 2.1, 2.2
**Domain:** general
**Atlas-impact:** none

Rationale: Wiring-only change in a large composition root. The factory pattern composes new dependencies (`createOwnerModelLookup`, `createDefaultScheduler`) and forwards the optional `body.model` through the adapter. No new behavior originates here — all logic is unit-tested in 1.x/2.x and end-to-end in 4.x. Per semantic-risk rule, this is glue code, so Test = none.

Edits, all in `src/index.ts`:

1. Add imports near the existing `auto-resume` imports (around line 51):

```typescript
import {
  type AutoResumeDispatcher,
  type AutoResumeEvent,
  type AutoResumeRegistry,
  type ClientPromptRequest,
  createAutoResumeDispatcher,
  createAutoResumeRegistry,
  createOwnerModelLookup,
  type OwnerModelClient,
} from "@/octto/auto-resume";
```

   Then export the new symbols from `src/octto/auto-resume/index.ts` if and only if a barrel file exists. If `src/octto/auto-resume/index.ts` does not exist, import directly from the relative module paths:

```typescript
import { createOwnerModelLookup, type OwnerModelClient } from "@/octto/auto-resume/model-lookup";
```

   (Implementer: choose whichever matches the existing import shape in this file. Today `index.ts` imports `createAutoResumeDispatcher` and `createAutoResumeRegistry` via `@/octto/auto-resume/dispatcher` and `@/octto/auto-resume/registry`; follow that pattern and add a third direct import for the model lookup.)

2. Replace the existing `createAutoResumeClient` adapter (lines 617-629) with a version that forwards the optional model:

```typescript
function createAutoResumeClient(client: PluginInput["client"]): AutoResumeClientAdapter {
  return {
    session: {
      prompt: (request: ClientPromptRequest) =>
        Promise.resolve(
          client.session.prompt({
            path: request.path,
            body: request.body.model
              ? {
                  parts: request.body.parts.map((part) => ({ type: part.type, text: part.text })),
                  model: request.body.model,
                }
              : { parts: request.body.parts.map((part) => ({ type: part.type, text: part.text })) },
          }),
        ),
    },
  };
}
```

3. Replace the `createAutoResumeDispatcher` invocation block (around lines 913-917) with:

```typescript
const ownerModelLookup = createOwnerModelLookup({
  client: ctx.client as unknown as OwnerModelClient,
});
const autoResumeDispatcher = createAutoResumeDispatcher({
  client: createAutoResumeClient(ctx.client),
  registry: autoResumeRegistry,
  buildPrompt: buildContinuePrompt,
  modelLookup: ownerModelLookup,
});
```

   Note: the `as unknown as OwnerModelClient` cast is intentional. The plugin's `ctx.client` is the full OpenCode SDK client; `OwnerModelClient` is a structural subset capturing just the `session.messages` shape needed by the lookup. This avoids importing SDK types into the auto-resume module while keeping the dispatcher unit-testable with simple mocks.

4. The existing `dispatchAutoResume` helper (around lines 475-488) needs no change — it already forwards `questionId` per event, and the dispatcher now does the batching internally.

**Verify:**
- `bun test tests/octto/auto-resume/` — confirms unit tests still pass.
- `bun run build` or `bun run typecheck` (whichever the repo uses) — confirms the wiring type-checks.
- `bun test tests/integration/octto-auto-resume.test.ts` — confirms the integration test still passes against the new wiring (it already only asserts one prompt for a single answer).

**Commit:** `feat(octto): wire dispatcher with model lookup and forward model to prompt`

---

## Batch 4: Integration & Regression (parallel - 2 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2

### Task 4.1: Add multi-answer batching and model passthrough integration test
**File:** `tests/integration/octto-auto-resume-batching.test.ts`
**Test:** (self — this task IS the test file)
**Depends:** 3.1
**Domain:** backend
**Atlas-impact:** none

Rationale: The existing `tests/integration/octto-auto-resume.test.ts` covers single-answer behavior and unregistered-owner behavior. The design's Testing Strategy demands explicit coverage for (a) multiple answers in one burst producing one prompt, (b) model inheritance reaching the prompt body, and (c) the model fallback path still sending a valid prompt. This new file adds those scenarios end-to-end through the real session store and WS message handler so we exercise the dispatcher's batching against the real event source.

```typescript
// tests/integration/octto-auto-resume-batching.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { ClientPromptRequest } from "@/octto/auto-resume/dispatcher";
import { createAutoResumeDispatcher } from "@/octto/auto-resume/dispatcher";
import type { OwnerModelLookup } from "@/octto/auto-resume/model-lookup";
import { buildContinuePrompt } from "@/octto/auto-resume/prompt";
import { createAutoResumeRegistry } from "@/octto/auto-resume/registry";
import type { Scheduler, ScheduledHandle } from "@/octto/auto-resume/scheduler";
import { createSessionStore, QUESTIONS, type SessionStore, WS_MESSAGES } from "@/octto/session";
import type { SessionListeners } from "@/octto/session/listeners";
import { stopSharedServer } from "@/octto/session/server";
import { config } from "@/utils/config";

const CONVERSATION_OWNER_ID = "conversation-owner-session";
const AUTO_RESUME_OWNER_ID = "auto-resume-owner-session";
const TITLE = "Auto resume batching";
const QUESTION_TEXT_A = "Question A?";
const QUESTION_TEXT_B = "Question B?";
const ANSWER_TEXT = "Answer.";
const EPHEMERAL_PORT = 0;
const PROMPT_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 10;
const QUIET_WINDOW_MS = 0;
const ORIGINAL_OCTTO_PORT = config.octto.port;

interface ManualScheduler extends Scheduler {
  readonly flush: () => Promise<void>;
}

function createManualScheduler(): ManualScheduler {
  const callbacks: Array<() => void> = [];
  return {
    schedule: (callback) => {
      callbacks.push(callback);
      const handle: ScheduledHandle = {
        cancel: () => {
          const index = callbacks.indexOf(callback);
          if (index >= 0) callbacks.splice(index, 1);
        },
      };
      return handle;
    },
    flush: async () => {
      const pending = callbacks.splice(0, callbacks.length);
      for (const cb of pending) cb();
      await Promise.resolve();
    },
  };
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    enumerable: true,
    value: port,
    writable: true,
  });
}

interface RecordedClient {
  readonly calls: ClientPromptRequest[];
  readonly session: { readonly prompt: (request: ClientPromptRequest) => Promise<void> };
}

function createRecordedClient(): RecordedClient {
  const calls: ClientPromptRequest[] = [];
  return {
    calls,
    session: {
      prompt: async (request) => {
        calls.push(request);
      },
    },
  };
}

function createFixedLookup(provider: string, model: string): OwnerModelLookup {
  return { resolve: async () => ({ providerID: provider, modelID: model }) };
}

function createNullLookup(): OwnerModelLookup {
  return { resolve: async () => null };
}

interface HarnessInput {
  readonly lookup: OwnerModelLookup;
}

interface Harness {
  readonly client: RecordedClient;
  readonly scheduler: ManualScheduler;
  readonly store: SessionStore;
}

function createHarness(input: HarnessInput): Harness {
  const client = createRecordedClient();
  const scheduler = createManualScheduler();
  const registry = createAutoResumeRegistry();
  const dispatcher = createAutoResumeDispatcher({
    client,
    registry,
    buildPrompt: buildContinuePrompt,
    scheduler,
    modelLookup: input.lookup,
    quietWindowMs: QUIET_WINDOW_MS,
  });
  registry.register("placeholder", AUTO_RESUME_OWNER_ID); // overwritten per test
  const listeners: SessionListeners = {
    onQuestionAnswered: (session, questionId) => {
      registry.register(session.id, AUTO_RESUME_OWNER_ID);
      void dispatcher.handle({
        conversationId: session.id,
        ownerSessionId: AUTO_RESUME_OWNER_ID,
        questionId,
        answeredAt: Date.now(),
      });
    },
  };
  return { client, scheduler, store: createSessionStore({ listeners, skipBrowser: true }) };
}

async function waitForCalls(client: RecordedClient, count: number): Promise<void> {
  const deadline = Date.now() + PROMPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (client.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Expected at least ${count} prompt calls, got ${client.calls.length}`);
}

describe("octto auto-resume batching integration", () => {
  let store: SessionStore | undefined;

  beforeEach(() => {
    setOcttoPort(EPHEMERAL_PORT);
  });

  afterEach(async () => {
    await store?.cleanup();
    store = undefined;
    await stopSharedServer();
    setOcttoPort(ORIGINAL_OCTTO_PORT);
  });

  it("coalesces a burst of WebSocket answers into a single prompt", async () => {
    const harness = createHarness({ lookup: createNullLookup() });
    store = harness.store;
    const started = await store.startSession({
      ownerSessionID: CONVERSATION_OWNER_ID,
      title: TITLE,
      questions: [
        { type: QUESTIONS.ASK_TEXT, config: { question: QUESTION_TEXT_A } },
        { type: QUESTIONS.ASK_TEXT, config: { question: QUESTION_TEXT_B } },
      ],
    });
    const [qa, qb] = started.question_ids ?? [];
    if (!qa || !qb) throw new Error("Expected two question ids");

    store.handleWsMessage(started.session_id, {
      type: WS_MESSAGES.RESPONSE,
      id: qa,
      answer: { text: ANSWER_TEXT },
    });
    store.handleWsMessage(started.session_id, {
      type: WS_MESSAGES.RESPONSE,
      id: qb,
      answer: { text: ANSWER_TEXT },
    });

    await harness.scheduler.flush();
    await waitForCalls(harness.client, 1);

    expect(harness.client.calls).toHaveLength(1);
    const text = harness.client.calls[0]?.body.parts[0]?.text ?? "";
    expect(text).toContain(qa);
    expect(text).toContain(qb);
  });

  it("inherits the owner session's model into the prompt body when lookup succeeds", async () => {
    const harness = createHarness({ lookup: createFixedLookup("wuxie-claude", "claude-opus-4-7") });
    store = harness.store;
    const started = await store.startSession({
      ownerSessionID: CONVERSATION_OWNER_ID,
      title: TITLE,
      questions: [{ type: QUESTIONS.ASK_TEXT, config: { question: QUESTION_TEXT_A } }],
    });
    const qa = started.question_ids?.[0];
    if (!qa) throw new Error("Expected initial question id");

    store.handleWsMessage(started.session_id, {
      type: WS_MESSAGES.RESPONSE,
      id: qa,
      answer: { text: ANSWER_TEXT },
    });

    await harness.scheduler.flush();
    await waitForCalls(harness.client, 1);

    expect(harness.client.calls[0]?.body.model).toEqual({
      providerID: "wuxie-claude",
      modelID: "claude-opus-4-7",
    });
  });

  it("still sends a valid prompt when model lookup returns null", async () => {
    const harness = createHarness({ lookup: createNullLookup() });
    store = harness.store;
    const started = await store.startSession({
      ownerSessionID: CONVERSATION_OWNER_ID,
      title: TITLE,
      questions: [{ type: QUESTIONS.ASK_TEXT, config: { question: QUESTION_TEXT_A } }],
    });
    const qa = started.question_ids?.[0];
    if (!qa) throw new Error("Expected initial question id");

    store.handleWsMessage(started.session_id, {
      type: WS_MESSAGES.RESPONSE,
      id: qa,
      answer: { text: ANSWER_TEXT },
    });

    await harness.scheduler.flush();
    await waitForCalls(harness.client, 1);

    expect(harness.client.calls[0]?.body.model).toBeUndefined();
    expect(harness.client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: started.session_id, questionIds: [qa] }),
    );
  });
});
```

**Verify:** `bun test tests/integration/octto-auto-resume-batching.test.ts`
**Commit:** `test(octto): cover batched auto-resume and model passthrough`

### Task 4.2: Regression sweep across existing octto suites
**File:** `tests/integration/octto-auto-resume.test.ts` (UPDATE: align the existing assertion to the new prompt builder signature)
**Test:** (self — runs the full existing octto/integration suites)
**Depends:** 3.1
**Domain:** backend
**Atlas-impact:** none

Rationale: The existing integration test calls `contractPrompt(conversationId, questionId)` and asserts the prompt string. After 2.1's rewrite, the single-answer wording is byte-identical, so the assertion stays correct. But for safety this task makes one minimal adjustment: replace the local helper's call shape to go through `buildContinuePrompt({ conversationId, questionIds: [questionId] })` so any future template change cannot drift away from the dispatcher. The persistence / forbidden-cross-conversation tests are not touched; they are simply re-run via the regression command.

Edit `tests/integration/octto-auto-resume.test.ts`:

Replace this block (around lines 95-99):

```typescript
function contractPrompt(conversationId: string, questionId: string): string {
  return `你之前的会话有用户回答到达 (question_id=${questionId})。请调用 \`get_next_answer({session_id: "${conversationId}"})\` 取出答案,然后继续原任务。`;
}
```

with:

```typescript
function contractPrompt(conversationId: string, questionId: string): string {
  return buildContinuePrompt({ conversationId, questionIds: [questionId] });
}
```

Then run the full regression to confirm no other test asserts on the old single-question-id dispatcher shape or the old prompt template:

**Verify:**

```sh
bun test tests/octto/auto-resume/
bun test tests/integration/octto-auto-resume.test.ts
bun test tests/integration/octto-auto-resume-batching.test.ts
bun test tests/octto/persistence/
bun test tests/octto/session/
bun test tests/octto/portal/
bun test tests/octto/integration/
bun test tests/octto/ui/
```

If any of these fail because the symbol `ClientPromptRequest.body.model` is now optional (i.e., an existing assertion expected no `model` field), confirm the failure is shape-only (extra optional field is fine for `toEqual` comparisons since `model` is `undefined`) and update the literal expectation only if necessary. Do NOT relax any persistence or forbidden-cross-conversation invariant.

**Commit:** `test(octto): align regression tests with new prompt builder signature`
