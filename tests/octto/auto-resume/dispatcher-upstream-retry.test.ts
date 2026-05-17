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
const QUESTION_ID = "question-1";
const OTHER_QUESTION_ID = "question-2";
const QUIET_WINDOW_MS = 50;
const ANSWERED_AT = 1_774_220_000_000;

interface TimedScheduler extends Scheduler {
  readonly pendingCount: () => number;
  readonly scheduledDelays: () => number[];
  readonly advanceBy: (ms: number) => Promise<void>;
}

interface PromptInput {
  readonly conversationId: string;
  readonly questionIds: readonly string[];
}

const EVENT: AutoResumeEvent = {
  conversationId: CONVERSATION_ID,
  ownerSessionId: OWNER_SESSION_ID,
  questionId: QUESTION_ID,
  answeredAt: ANSWERED_AT,
};

function createEvent(overrides: Partial<AutoResumeEvent>): AutoResumeEvent {
  return { ...EVENT, ...overrides };
}

function createTimedScheduler(): TimedScheduler {
  let now = 0;
  const pending: Array<{ active: boolean; callback: () => void; runAt: number; delayMs: number }> = [];

  return {
    pendingCount: () => pending.filter((entry) => entry.active).length,
    scheduledDelays: () => pending.filter((entry) => entry.active).map((entry) => entry.delayMs),
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
      const entry = { active: true, callback, runAt: now + delayMs, delayMs };
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
  return `${input.conversationId}:${input.questionIds.join(",")}`;
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

describe("auto-resume dispatcher upstream_error retry", () => {
  it("retries recoverable upstream prompt failures after workflow interval with same batch identity", async () => {
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

    await dispatcher.handle(EVENT);
    await scheduler.advanceBy(QUIET_WINDOW_MS);

    expect(calls).toHaveLength(1);
    expect(scheduler.scheduledDelays()).toContain(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls).toEqual([
      {
        path: { id: OWNER_SESSION_ID },
        body: { parts: [{ type: "text", text: `${CONVERSATION_ID}:${QUESTION_ID}` }] },
      },
      {
        path: { id: OWNER_SESSION_ID },
        body: { parts: [{ type: "text", text: `${CONVERSATION_ID}:${QUESTION_ID}` }] },
      },
    ]);
  });

  it("does not merge unrelated conversation answers into a scheduled upstream retry", async () => {
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

    await dispatcher.handle(EVENT);
    await scheduler.advanceBy(QUIET_WINDOW_MS);
    await dispatcher.handle(createEvent({ conversationId: OTHER_CONVERSATION_ID, questionId: OTHER_QUESTION_ID }));
    await scheduler.advanceBy(QUIET_WINDOW_MS);
    await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:${QUESTION_ID}`,
      `${OTHER_CONVERSATION_ID}:${OTHER_QUESTION_ID}`,
      `${CONVERSATION_ID}:${QUESTION_ID}`,
    ]);
  });

  it("retries two failed conversations for the same owner with their own question ids", async () => {
    const calls: ClientPromptRequest[] = [];
    const attemptCountByPrompt = new Map<string, number>();
    const client = {
      session: {
        prompt: async (request: ClientPromptRequest) => {
          calls.push(request);
          const text = request.body.parts[0].text;
          const attemptCount = attemptCountByPrompt.get(text) ?? 0;
          attemptCountByPrompt.set(text, attemptCount + 1);
          if (attemptCount === 0) throw new Error("upstream_error: Upstream request failed");
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

    await dispatcher.handle(EVENT);
    await dispatcher.handle(createEvent({ conversationId: OTHER_CONVERSATION_ID, questionId: OTHER_QUESTION_ID }));
    await scheduler.advanceBy(QUIET_WINDOW_MS);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:${QUESTION_ID}`,
      `${OTHER_CONVERSATION_ID}:${OTHER_QUESTION_ID}`,
    ]);
    expect(scheduler.scheduledDelays()).toEqual([
      WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs,
      WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs,
    ]);

    await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:${QUESTION_ID}`,
      `${OTHER_CONVERSATION_ID}:${OTHER_QUESTION_ID}`,
      `${CONVERSATION_ID}:${QUESTION_ID}`,
      `${OTHER_CONVERSATION_ID}:${OTHER_QUESTION_ID}`,
    ]);
  });

  it("keeps non-upstream prompt failures as warn-only without retry", async () => {
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

    const warnings = await captureWarnings(async () => {
      await dispatcher.handle(EVENT);
      await scheduler.advanceBy(QUIET_WINDOW_MS);
      await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs * 2);
    });

    expect(calls).toHaveLength(1);
    expect(scheduler.pendingCount()).toBe(0);
    expect(warnings).toEqual(["[octto.auto-resume] Failed to dispatch auto-resume prompt: prompt failed"]);
  });

  it("does not retry when the conversation has no owner session", async () => {
    const calls: ClientPromptRequest[] = [];
    const registry = createAutoResumeRegistry();
    const scheduler = createTimedScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client: {
        session: {
          prompt: async (request) => {
            calls.push(request);
            throw new Error("upstream_error: Upstream request failed");
          },
        },
      },
      registry,
      buildPrompt,
      modelLookup: createModelLookup(),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.advanceBy(QUIET_WINDOW_MS + WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(calls).toHaveLength(0);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("caps upstream retry prompt attempts at the workflow policy limit", async () => {
    const calls: ClientPromptRequest[] = [];
    const registry = createAutoResumeRegistry();
    const scheduler = createTimedScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client: {
        session: {
          prompt: async (request) => {
            calls.push(request);
            throw new Error("upstream_error: Upstream request failed");
          },
        },
      },
      registry,
      buildPrompt,
      modelLookup: createModelLookup(),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.advanceBy(QUIET_WINDOW_MS);
    for (let i = 0; i < WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts; i++) {
      await scheduler.advanceBy(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);
    }

    expect(calls).toHaveLength(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
