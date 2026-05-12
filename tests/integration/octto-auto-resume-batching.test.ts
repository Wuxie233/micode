import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { ClientPromptRequest } from "@/octto/auto-resume/dispatcher";
import { createAutoResumeDispatcher } from "@/octto/auto-resume/dispatcher";
import type { OwnerModelLookup } from "@/octto/auto-resume/model-lookup";
import { buildContinuePrompt } from "@/octto/auto-resume/prompt";
import { createAutoResumeRegistry } from "@/octto/auto-resume/registry";
import type { ScheduledHandle, Scheduler } from "@/octto/auto-resume/scheduler";
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
  registry.register("placeholder", AUTO_RESUME_OWNER_ID);
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
    expect(harness.client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: started.session_id, questionIds: [qa, qb] }),
    );
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

    expect(harness.client.calls[0]?.body).not.toHaveProperty("model");
    expect(harness.client.calls[0]?.body.parts[0]?.text).toBe(
      buildContinuePrompt({ conversationId: started.session_id, questionIds: [qa] }),
    );
  });
});
