---
date: 2026-04-29
topic: "Agent-owned conversation titles"
issue: 9
scope: conversation-title
contract: none
---

# Agent-owned conversation titles Implementation Plan

**Goal:** Stop ordinary `chat.message` events from writing conversation titles by default, while preserving every other strong signal (lifecycle, plan/design writes, finish events) and existing safeties (opt-out, throttle, done freeze, internal session skipping, max length).

**Architecture:** Introduce a single boolean `chatFallbackEnabled` on `ConversationTitleConfig` (default `false`). The chat-message handler in `src/hooks/conversation-title.ts` short-circuits when the flag is off, before any low-info filtering or registry interaction. Expose the same flag through `MicodeFeatures.conversationTitleChatFallback` in `micode.json`/`micode.jsonc`, mirroring the existing `mindmodelInjection` opt-in flag pattern, so users who want the old behavior can opt back in. Wire it once in `src/index.ts` where the hook is constructed. The classifier, registry, formatter, and tool-milestone path are untouched: this PR is a pure default-flip plus opt-in compatibility switch.

**Design:** [thoughts/shared/designs/2026-04-29-agent-owned-conversation-title-design.md](../designs/2026-04-29-agent-owned-conversation-title-design.md)

**Contract:** none (single-domain, all backend/general TypeScript files in this repo)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1 [foundation - schema field, no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 [hook + wiring + tests + docs - depend on 1.1]
```

Rationale: every batch-2 file either reads the new `MicodeFeatures.conversationTitleChatFallback` field declared by the schema in 1.1, or asserts behavior that depends on the new `ConversationTitleConfig.chatFallbackEnabled` option being plumbed end-to-end. Within batch 2, the seven files do not import each other in a way that creates ordering, so they run in parallel; integration is verified by `bun run check` after the batch lands.

---

## Batch 1: Foundation (parallel - 1 implementer)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1

### Task 1.1: Add `conversationTitleChatFallback` to features schema
**File:** `src/config-schemas.ts`
**Test:** `tests/config-schemas.test.ts` does not exist; behavior is covered through `tests/config-loader.test.ts` in Task 2.5
**Depends:** none
**Domain:** general

This adds a new optional boolean field to the existing `MicodeFeaturesSchema`. The field is the user-facing opt-in for the legacy chat fallback behavior; defaulting to `undefined` (treated as `false` downstream) implements the design's "no chat fallback by default" decision.

Patch (replace the existing `MicodeFeaturesSchema` block; everything else in the file is unchanged):

```typescript
const MicodeFeaturesSchema = v.object({
  mindmodelInjection: v.optional(v.boolean()),
  conversationTitleChatFallback: v.optional(v.boolean()),
});
```

**Verify:** `bun run typecheck && bun test tests/config-loader.test.ts`
**Commit:** `feat(conversation-title): add conversationTitleChatFallback features schema field`



---

## Batch 2: Hook + Wiring + Tests + Docs (parallel - 7 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7

### Task 2.1: Extend `MicodeFeatures` interface in config-loader
**File:** `src/config-loader.ts`
**Test:** `tests/config-loader.test.ts` (extended in Task 2.5)
**Depends:** 1.1 (schema must already accept the field)
**Domain:** general

Add the matching field to the public `MicodeFeatures` interface so consumers can read `userConfig.features.conversationTitleChatFallback` with full TypeScript inference. The existing `sanitizeFeatures(...)` already reads through `MicodeFeaturesSchema` from `@/config-schemas`, so once Task 1.1 lands, the loader needs no further runtime change: only the exported interface needs the new optional property.

Patch (replace the existing `MicodeFeatures` interface block; everything else in the file is unchanged):

```typescript
export interface MicodeFeatures {
  readonly mindmodelInjection?: boolean;
  readonly conversationTitleChatFallback?: boolean;
}
```

Note on `readonly`: the existing block in the file does not mark `mindmodelInjection` as `readonly`. Match the existing style in this file: if the existing field is not `readonly`, do not introduce `readonly` for the new field. The implementer should preserve the file's local convention by inspecting the current declaration before editing.

**Verify:** `bun run typecheck`
**Commit:** `feat(conversation-title): expose conversationTitleChatFallback on MicodeFeatures`

---

### Task 2.2: Gate chat-message handler on `chatFallbackEnabled`
**File:** `src/hooks/conversation-title.ts`
**Test:** `tests/hooks/conversation-title.test.ts` (rewritten in Task 2.3)
**Depends:** 1.1 (semantic alignment with feature flag), 2.1 (interface)
**Domain:** general

Add a new boolean `chatFallbackEnabled` to `ConversationTitleConfig`, default to `false`, and short-circuit `handleChatMessage` when it is off. The tool-milestone path, registry, classifier, opt-out detection, throttle, done freeze, internal-session skip, and `session.deleted` cleanup are unchanged.

Implementation requirements (apply as targeted edits inside the existing file; do not rewrite the whole file):

1. Extend the exported config type:

```typescript
export interface ConversationTitleConfig {
  readonly enabled: boolean;
  readonly chatFallbackEnabled: boolean;
  readonly maxLength: number;
  readonly isInternalSession?: (sessionID: string) => boolean;
}
```

2. Update the default-config factory so the legacy fallback is OFF by default:

```typescript
const defaultConfig = (): ConversationTitleConfig => ({
  enabled: true,
  chatFallbackEnabled: false,
  maxLength: DEFAULT_MAX_LENGTH,
});
```

3. Add the early-return at the top of `handleChatMessage`, before `registry.isOptedOut`, before `fetchSessionInfo`, before low-info checks, so a disabled fallback never touches state and never makes a session API call:

```typescript
const handleChatMessage = async (
  deps: ContextDeps,
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> => {
  if (!deps.config.enabled) return;
  if (!deps.config.chatFallbackEnabled) return;
  if (deps.registry.isOptedOut(input.sessionID)) return;

  const info = await fetchSessionInfo(deps.ctx, input.sessionID);
  if (!isMainAgentSession(info)) return;

  const summary = summaryFromUserMessage(extractMessageText(output));
  if (!summary) return;
  if (isLowInformationMessage(summary)) return;

  await dispatch(deps, input.sessionID, {
    status: TITLE_STATUS.INITIALIZING,
    summary,
    source: TITLE_SOURCE.USER_MESSAGE,
    currentTitle: info?.title ?? null,
  });
};
```

4. The factory `createConversationTitleHook(ctx, overrides)` already spreads `overrides` over `defaultConfig()`, so callers can opt in by passing `{ chatFallbackEnabled: true }`. No factory signature change.

Note on naming: the design uses the phrase "opt-in compatibility mode". I am intentionally not introducing a separate enum or mode object: a single boolean named for what it actually toggles is the smallest surface that matches the design constraint. If a future explicit "agent semantic title" event is added, it will be a new title source in `source.ts`, not a new config mode.

**Verify:** `bun run typecheck && bun test tests/hooks/conversation-title.test.ts tests/hooks/conversation-title.scenario.test.ts`
**Commit:** `feat(conversation-title): disable chat fallback by default with chatFallbackEnabled flag`

---

### Task 2.3: Update `conversation-title.test.ts` for default-disabled fallback
**File:** `tests/hooks/conversation-title.test.ts`
**Test:** this is the test file
**Depends:** 1.1, 2.1, 2.2
**Domain:** general

Three existing test cases assume chat fallback is on by default and must be flipped, plus add new coverage for both the default-off behavior and the opt-in path. Keep all other test cases as-is.

Required changes (apply as Edit operations, not a full rewrite):

1. The test "renames on the first user message of a session" (currently around line 124) must become two tests:

```typescript
it("does NOT rename on chat messages by default (chat fallback disabled)", async () => {
  const hook = createConversationTitleHook(harness.ctx);

  await hook["chat.message"](
    { sessionID: SESSION_MAIN },
    { parts: [{ type: "text", text: "  设计 对话名 自动更新  " }] },
  );

  expect(harness.updates).toHaveLength(0);
});

it("renames on the first user message when chatFallbackEnabled opt-in is set", async () => {
  const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

  await hook["chat.message"](
    { sessionID: SESSION_MAIN },
    { parts: [{ type: "text", text: "  设计 对话名 自动更新  " }] },
  );

  expect(harness.updates).toHaveLength(1);
  expect(harness.updates[0]?.title).toBe("设计 对话名 自动更新");
});
```

2. The tests "ignores '重启了' chat message" (around line 136) and "ignores '继续' / 'ok' / '这是符合预期吗' chat messages" (around line 144) currently rely on the low-info filter under default-on fallback. Under the new default they would pass trivially. Re-anchor them to the opt-in path so they continue to assert the low-info filter:

```typescript
it("ignores '重启了' chat message even when chatFallbackEnabled is on", async () => {
  const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

  await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "重启了" }] });

  expect(harness.updates).toHaveLength(0);
});

it("ignores '继续' / 'ok' / '这是符合预期吗' chat messages even when chatFallbackEnabled is on", async () => {
  const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });
  const messages = ["继续", "ok", "这是符合预期吗"] as const;

  for (const message of messages) {
    await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: message }] });
  }

  expect(harness.updates).toHaveLength(0);
});
```

3. The test "keeps a lifecycle topic when a later user message arrives" (around line 171) currently sends an arbitrary chat message ("加个按钮") after lifecycle_start. With default-off fallback the chat message becomes a no-op and the assertion still holds, but the test's narrative changes. Update its name and add an explicit comment so the intent is clear:

```typescript
it("keeps a lifecycle topic when a later non-low-info chat message arrives (chat fallback off)", async () => {
  const hook = createConversationTitleHook(harness.ctx);

  await hook["tool.execute.after"](
    {
      tool: "lifecycle_start_request",
      sessionID: SESSION_MAIN,
      args: { summary: "修复 fork 检测", goals: [], constraints: [] },
    },
    { output: "" },
  );
  await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "加个按钮" }] });

  expect(harness.updates).toHaveLength(1);
  expect(harness.updates.at(-1)?.title).toBe("修复 fork 检测");
});
```

4. Add one new test that proves the chat fallback short-circuit happens BEFORE any session API call, matching the design's "no decision made" guarantee:

```typescript
it("does not call session.get for chat messages when chat fallback is disabled", async () => {
  let getCalls = 0;
  const ctx = {
    directory: "/tmp/fake-project",
    client: {
      session: {
        get: async () => {
          getCalls += 1;
          return { data: { id: SESSION_MAIN, title: null, parentID: null } };
        },
        update: async () => ({ data: { id: SESSION_MAIN } }),
      },
    },
  } as unknown as PluginInput;

  const hook = createConversationTitleHook(ctx);
  await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "anything" }] });

  expect(getCalls).toBe(0);
});
```

Do not touch the tool-milestone tests, the parent-session test, the internal-session test, the opt-out + done-freeze test, the `session.deleted` test, or the `session.update` error swallow test: all of those exercise paths that the design says must remain working.

**Verify:** `bun test tests/hooks/conversation-title.test.ts`
**Commit:** `test(conversation-title): cover default-off chat fallback and opt-in compatibility`

---

### Task 2.4: Update `conversation-title.scenario.test.ts` for default-disabled fallback
**File:** `tests/hooks/conversation-title.scenario.test.ts`
**Test:** this is the test file
**Depends:** 1.1, 2.1, 2.2
**Domain:** general

The scenario "keeps the lifecycle topic stable until the work is completed" currently begins with `await sendMessage(hook, FIRST_USER_TITLE)` and asserts that the chat fallback names the session. Under the new default this no longer happens, but the scenario's actual purpose (lifecycle topic dominates and freezes through done) is preserved. Two options:

Choice (I am picking option A; documenting why): keep the scenario faithful to the new default by removing the chat-driven first naming and asserting that the title remains `null` until lifecycle_start. Do NOT change the second scenario "keeps done title frozen" because it does not use chat fallback at all.

Required edits to the first scenario "keeps the lifecycle topic stable until the work is completed":

```typescript
it("keeps the lifecycle topic stable until the work is completed", async () => {
  // Chat fallback is off by default. The first user message no longer renames.
  await sendMessage(hook, FIRST_USER_TITLE);
  expect(currentTitle(harness)).toBeNull();
  expect(harness.updates).toHaveLength(0);

  await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
    summary: LIFECYCLE_TITLE,
    goals: [],
    constraints: [],
  });
  expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

  await runTool(hook, TOOL_NAMES.WRITE, { filePath: PLAN_PATH });
  expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

  const updatesAfterPlan = harness.updates.length;
  for (const message of LOW_INFO_MESSAGES) {
    await sendMessage(hook, message);
  }
  expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);
  expect(harness.updates).toHaveLength(updatesAfterPlan);

  await runTool(hook, TOOL_NAMES.LIFECYCLE_COMMIT, {
    issue_number: ISSUE_NUMBER,
    scope: COMMIT_SCOPE,
    summary: COMMIT_SUMMARY,
  });
  expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

  await runTool(hook, TOOL_NAMES.LIFECYCLE_FINISH, { issue_number: ISSUE_NUMBER }, FINISH_OUTPUT);
  expect(currentTitle(harness)).toBe(FINISHED_TITLE);
  expect(harness.updates.at(-1)).toEqual({ id: SESSION_MAIN, title: FINISHED_TITLE });
});
```

Add a new third scenario that asserts the opt-in compatibility path still produces the legacy behavior end-to-end (this proves the design constraint "compatibility config keeps old behavior if exposed"):

```typescript
it("keeps the legacy chat-driven first title when chatFallbackEnabled is opted in", async () => {
  hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

  await sendMessage(hook, FIRST_USER_TITLE);
  expect(currentTitle(harness)).toBe(FIRST_USER_TITLE);

  await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
    summary: LIFECYCLE_TITLE,
    goals: [],
    constraints: [],
  });
  expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);
});
```

Do not touch `LOW_INFO_MESSAGES`, `FIRST_USER_TITLE`, `LIFECYCLE_TITLE`, `FINISHED_TITLE`, `PLAN_PATH`, or any of the other constants. They are still useful, just under different paths.

**Verify:** `bun test tests/hooks/conversation-title.scenario.test.ts`
**Commit:** `test(conversation-title): align scenario with default-off chat fallback`

---

### Task 2.5: Add config-loader test for `conversationTitleChatFallback`
**File:** `tests/config-loader.test.ts`
**Test:** this is the test file
**Depends:** 1.1, 2.1
**Domain:** general

Add one new `it(...)` inside the existing `describe` that already tests `mindmodelInjection` (the same describe block that contains the JSONC parsing test around line 686). The new test asserts the loader round-trips the new opt-in flag.

```typescript
it("parses features.conversationTitleChatFallback opt-in flag", async () => {
  const configPath = join(testConfigDir, "micode.jsonc");
  writeFileSync(
    configPath,
    `{
  "features": {
    "conversationTitleChatFallback": true
  }
}`,
  );

  const config = await loadMicodeConfig(testConfigDir);

  expect(config).not.toBeNull();
  expect(config?.features?.conversationTitleChatFallback).toBe(true);
});

it("treats missing conversationTitleChatFallback as undefined (not enabled)", async () => {
  const configPath = join(testConfigDir, "micode.jsonc");
  writeFileSync(
    configPath,
    `{
  "features": {
    "mindmodelInjection": true
  }
}`,
  );

  const config = await loadMicodeConfig(testConfigDir);

  expect(config).not.toBeNull();
  expect(config?.features?.conversationTitleChatFallback).toBeUndefined();
});
```

The implementer should locate the matching `describe` block by searching for `mindmodelInjection` in this file (it appears around lines 699-711) and insert the two new `it(...)` cases adjacent to it. The `testConfigDir`, `writeFileSync`, and `join` imports are already in scope; reuse them.

**Verify:** `bun test tests/config-loader.test.ts`
**Commit:** `test(config-loader): cover conversationTitleChatFallback opt-in flag`

---

### Task 2.6: Wire `chatFallbackEnabled` from user config in `src/index.ts`
**File:** `src/index.ts`
**Test:** indirectly covered by 2.3, 2.4, 2.5; no new test file
**Depends:** 1.1, 2.1, 2.2
**Domain:** general

The hook is constructed at line 293 via `createConversationTitleHook(ctx, { isInternalSession: ... })`. Add the new flag, sourced from the loaded `userConfig`, with explicit `=== true` to keep the default safely off when the field is missing or non-boolean. Mirror the `mindmodelInjection` feature-flag style already used at line 299.

Patch (apply as a targeted Edit on the existing call site; everything else in the file is unchanged):

```typescript
const conversationTitleHook = createConversationTitleHook(ctx, {
  chatFallbackEnabled: userConfig?.features?.conversationTitleChatFallback === true,
  isInternalSession: (sessionID) => internalSessions.has(sessionID),
});
```

Why `=== true` instead of `?? false` or just the bare value: the schema marks the field optional, so the runtime value is `boolean | undefined`. An explicit equality check makes the intent unambiguous to a reader and survives any future schema relaxation (for example, accidentally accepting a string).

**Verify:** `bun run typecheck && bun run check`
**Commit:** `feat(conversation-title): wire conversationTitleChatFallback feature flag in plugin entry`

---

### Task 2.7: Document the opt-in flag in `micode.example.jsonc`
**File:** `micode.example.jsonc`
**Test:** none (config example)
**Depends:** 1.1 (so the documented field is real)
**Domain:** general

Extend the commented "features" example block at lines 51-53 so users discover the new flag and understand the default. Keep the block commented out: it is example documentation, not active config.

Patch (replace the existing commented `features` block; everything else in the file is unchanged):

```jsonc
  // "features": {
  //   "mindmodelInjection": true,
  //   // Re-enable the legacy chat-message title fallback. Off by default in
  //   // micode v9: ordinary chat messages no longer rename the conversation;
  //   // titles come from lifecycle and tool milestones (lifecycle_start_request,
  //   // lifecycle_commit, lifecycle_finish, plan/design writes). Set to true
  //   // only if you want the pre-v9 behavior where the first user message
  //   // sets the title.
  //   "conversationTitleChatFallback": false
  // },
```

**Verify:** open the file in an editor or run `bun -e "import('jsonc-parser').then(m => { const errs=[]; m.parse(require('node:fs').readFileSync('micode.example.jsonc','utf8'), errs, { allowTrailingComma: true }); console.log(errs); })"` to confirm zero parse errors.
**Commit:** `docs(conversation-title): document conversationTitleChatFallback opt-in flag`


