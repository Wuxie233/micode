import { describe, expect, it } from "bun:test";
import type { ClientPromptRequest } from "../../../src/octto/auto-resume/dispatcher";
import { type AutoResumeEvent, createAutoResumeDispatcher } from "../../../src/octto/auto-resume/dispatcher";
import type { OwnerModelLookup } from "../../../src/octto/auto-resume/model-lookup";
import { createAutoResumeRegistry } from "../../../src/octto/auto-resume/registry";
import type { Scheduler } from "../../../src/octto/auto-resume/scheduler";
import type { ModelReference } from "../../../src/utils/model-selection";

const CONVERSATION_ID = "conversation-1";
const OWNER_SESSION_ID = "owner-session-1";
const QUESTION_ID = "question-1";
const SECOND_QUESTION_ID = "question-2";
const ANSWERED_AT = 1_774_220_000_000;
const QUIET_WINDOW_MS = 50;
const WARNING = "[octto.auto-resume] Failed to dispatch auto-resume prompt: prompt failed";

interface RecordedClient {
  readonly calls: ClientPromptRequest[];
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<void>;
  };
}

interface ManualScheduler extends Scheduler {
  readonly pendingCount: () => number;
  readonly runNext: () => Promise<void>;
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

function createManualScheduler(): ManualScheduler {
  const pending: Array<{ active: boolean; callback: () => void; delayMs: number }> = [];

  return {
    pendingCount: () => pending.filter((entry) => entry.active).length,
    runNext: async () => {
      const entry = pending.find((candidate) => candidate.active);
      if (!entry) return;

      entry.active = false;
      entry.callback();
      await Promise.resolve();
      await Promise.resolve();
    },
    schedule: (callback, delayMs) => {
      const entry = { active: true, callback, delayMs };
      pending.push(entry);

      return {
        cancel: () => {
          entry.active = false;
        },
      };
    },
  };
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

function createModelLookup(model: ModelReference | null): OwnerModelLookup {
  return {
    resolve: async () => model,
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

describe("auto-resume dispatcher", () => {
  it("collapses a burst of two events into one prompt with both ids and no model", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await dispatcher.handle(createEvent({ questionId: SECOND_QUESTION_ID }));
    await scheduler.runNext();

    expect(client.calls).toEqual([
      {
        path: { id: OWNER_SESSION_ID },
        body: {
          parts: [{ type: "text", text: `${CONVERSATION_ID}:${QUESTION_ID},${SECOND_QUESTION_ID}` }],
        },
      },
    ]);
  });

  it("still sends one prompt for one answer", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.runNext();

    expect(client.calls).toEqual([
      {
        path: { id: OWNER_SESSION_ID },
        body: {
          parts: [{ type: "text", text: `${CONVERSATION_ID}:${QUESTION_ID}` }],
        },
      },
    ]);
  });

  it("does not merge events across a flush boundary", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.runNext();
    await dispatcher.handle(createEvent({ questionId: SECOND_QUESTION_ID }));
    await scheduler.runNext();

    expect(client.calls.map((call) => call.body.parts[0].text)).toEqual([
      `${CONVERSATION_ID}:${QUESTION_ID}`,
      `${CONVERSATION_ID}:${SECOND_QUESTION_ID}`,
    ]);
  });

  it("includes model when lookup resolves", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const model = { providerID: "openai", modelID: "gpt-5" };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(model),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.runNext();

    expect(client.calls[0]?.body.model).toEqual(model);
  });

  it("omits model when lookup returns null", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await scheduler.runNext();

    expect(client.calls[0]?.body).not.toHaveProperty("model");
  });

  it("skips dispatch with no registered owner and leaves no pending scheduler callback", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);

    expect(client.calls).toEqual([]);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("swallows prompt failures after logging warning", async () => {
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
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    const warnings = await captureWarnings(async () => {
      await dispatcher.handle(EVENT);
      await scheduler.runNext();
    });

    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([WARNING]);
  });

  it("deduplicates repeated question ids within same batch", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const scheduler = createManualScheduler();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry,
      buildPrompt,
      modelLookup: createModelLookup(null),
      scheduler,
      quietWindowMs: QUIET_WINDOW_MS,
    });

    await dispatcher.handle(EVENT);
    await dispatcher.handle(EVENT);
    await scheduler.runNext();

    expect(client.calls.map((call) => call.body.parts[0].text)).toEqual([`${CONVERSATION_ID}:${QUESTION_ID}`]);
  });
});
