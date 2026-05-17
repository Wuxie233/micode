import { describe, expect, it } from "bun:test";

import type { ClientPromptRequest } from "../../../src/octto/auto-resume/dispatcher";
import { type AutoResumeEvent, createAutoResumeDispatcher } from "../../../src/octto/auto-resume/dispatcher";
import type { OwnerModelLookup } from "../../../src/octto/auto-resume/model-lookup";
import { createAutoResumeRegistry } from "../../../src/octto/auto-resume/registry";
import type { Scheduler } from "../../../src/octto/auto-resume/scheduler";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "../../../src/workflow-retry/policy";

const OWNER_SESSION_ID = "owner-session-1";
const CONVERSATION_ID = "conversation-1";
const OTHER_CONVERSATION_ID = "conversation-2";
const QUIET_WINDOW_MS = 50;
const ANSWERED_AT = 1_774_220_000_000;

interface TimedScheduler extends Scheduler {
  readonly pendingCount: () => number;
  readonly advanceBy: (ms: number) => Promise<void>;
}

interface PromptInput {
  readonly conversationId: string;
  readonly questionIds: readonly string[];
}

function createEvent(overrides: Partial<AutoResumeEvent>): AutoResumeEvent {
  return {
    conversationId: CONVERSATION_ID,
    ownerSessionId: OWNER_SESSION_ID,
    questionId: "question-1",
    answeredAt: ANSWERED_AT,
    ...overrides,
  };
}

function createTimedScheduler(): TimedScheduler {
  let now = 0;
  const pending: Array<{ active: boolean; callback: () => void; runAt: number }> = [];

  return {
    pendingCount: () => pending.filter((entry) => entry.active).length,
    advanceBy: async (ms) => {
      now += ms;

      while (true) {
        const next = pending
          .filter((entry) => entry.active && entry.runAt <= now)
          .sort((a, b) => a.runAt - b.runAt)[0];
        if (!next) return;

        next.active = false;
        next.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    schedule: (callback, delayMs) => {
      const entry = { active: true, callback, runAt: now + delayMs };
      pending.push(entry);

      return {
        cancel: () => {
          entry.active = false;
        },
      };
    },
  };
}

function createModelLookup(): OwnerModelLookup {
  return {
    resolve: async () => null,
  };
}

function buildPrompt(input: PromptInput): string {
  return `${input.conversationId}:${input.questionIds.join("|")}`;
}

describe("auto-resume dispatcher upstream_error integration", () => {
  it("preserves a multi-question batch across an upstream retry", async () => {
    const calls: ClientPromptRequest[] = [];
    const client = {
      session: {
        prompt: async (request: ClientPromptRequest) => {
          calls.push(request);
          if (calls.length === 1) throw new Error("upstream_error: Upstream request failed");
        },
      },
    };
    const registry = createAutoResumeRegistry();
    const scheduler = createTimedScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(createEvent({ questionId: "question-1" }));
    await dispatcher.handle(createEvent({ questionId: "question-2" }));
    await dispatcher.handle(createEvent({ questionId: "question-3" }));
    await scheduler.advanceBy(QUIET_WINDOW_MS);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:question-1|question-2|question-3`,
    ]);

    await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:question-1|question-2|question-3`,
      `${CONVERSATION_ID}:question-1|question-2|question-3`,
    ]);
  });

  it("does not re-batch a scheduled retry with another conversation for the same owner", async () => {
    const calls: ClientPromptRequest[] = [];
    const client = {
      session: {
        prompt: async (request: ClientPromptRequest) => {
          calls.push(request);
          if (calls.length === 1) throw new Error("upstream_error: Upstream request failed");
        },
      },
    };
    const registry = createAutoResumeRegistry();
    const scheduler = createTimedScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    registry.register(OTHER_CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(createEvent({ conversationId: CONVERSATION_ID, questionId: "question-a" }));
    await scheduler.advanceBy(QUIET_WINDOW_MS);

    await dispatcher.handle(createEvent({ conversationId: OTHER_CONVERSATION_ID, questionId: "question-b" }));
    await scheduler.advanceBy(QUIET_WINDOW_MS);
    await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:question-a`,
      `${OTHER_CONVERSATION_ID}:question-b`,
      `${CONVERSATION_ID}:question-a`,
    ]);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
