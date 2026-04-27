import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { ClientPromptRequest } from "@/octto/auto-resume/dispatcher";
import { type AutoResumeDispatcher, createAutoResumeDispatcher } from "@/octto/auto-resume/dispatcher";
import { buildContinuePrompt } from "@/octto/auto-resume/prompt";
import { type AutoResumeRegistry, createAutoResumeRegistry } from "@/octto/auto-resume/registry";
import { createSessionStore, QUESTIONS, type SessionStore, STATUSES, WS_MESSAGES } from "@/octto/session";
import type { SessionListeners } from "@/octto/session/listeners";
import { stopSharedServer } from "@/octto/session/server";
import { config } from "@/utils/config";

const CONVERSATION_OWNER_ID = "conversation-owner-session";
const AUTO_RESUME_OWNER_ID = "auto-resume-owner-session";
const TITLE = "Auto resume integration";
const QUESTION_TEXT = "What should happen next?";
const ANSWER_TEXT = "Continue the original task.";
const EPHEMERAL_PORT = 0;
const PROMPT_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 10;
const EXPECTED_PROMPT_CALLS = 1;
const ORIGINAL_OCTTO_PORT = config.octto.port;

interface RecordedClient {
  readonly calls: ClientPromptRequest[];
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<unknown>;
  };
}

interface AutoResumeInput {
  readonly registry: AutoResumeRegistry;
  readonly dispatcher: AutoResumeDispatcher;
}

interface Harness {
  readonly client: RecordedClient;
  readonly registry: AutoResumeRegistry;
  readonly store: SessionStore;
}

interface Conversation {
  readonly id: string;
  readonly questionId: string;
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    enumerable: true,
    value: port,
    writable: true,
  });
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

function createDispatcherListener(input: AutoResumeInput): SessionListeners {
  return {
    onQuestionAnswered: (session, questionId) => {
      const ownerSessionId = input.registry.lookup(session.id);
      if (!ownerSessionId) return;

      void input.dispatcher.handle({
        conversationId: session.id,
        ownerSessionId,
        questionId,
        answeredAt: Date.now(),
      });
    },
  };
}

function createHarness(): Harness {
  const client = createRecordedClient();
  const registry = createAutoResumeRegistry();
  const dispatcher = createAutoResumeDispatcher({ client, registry, buildPrompt: buildContinuePrompt });
  const listeners = createDispatcherListener({ registry, dispatcher });

  return {
    client,
    registry,
    store: createSessionStore({ listeners, skipBrowser: true }),
  };
}

function contractPrompt(conversationId: string, questionId: string): string {
  return `你之前的会话有用户回答到达 (question_id=${questionId})。请调用 \`get_next_answer({session_id: "${conversationId}"})\` 取出答案,然后继续原任务。`;
}

async function startConversation(store: SessionStore): Promise<Conversation> {
  const started = await store.startSession({
    ownerSessionID: CONVERSATION_OWNER_ID,
    title: TITLE,
    questions: [{ type: QUESTIONS.ASK_TEXT, config: { question: QUESTION_TEXT } }],
  });
  const questionId = started.question_ids?.[0];
  if (!questionId) throw new Error("Expected initial question id");
  return { id: started.session_id, questionId };
}

function answerQuestion(store: SessionStore, conversation: Conversation): void {
  store.handleWsMessage(conversation.id, {
    type: WS_MESSAGES.RESPONSE,
    id: conversation.questionId,
    answer: { text: ANSWER_TEXT },
  });
}

async function waitForCalls(client: RecordedClient, count: number): Promise<void> {
  const deadline = Date.now() + PROMPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (client.calls.length === count) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Expected ${count} prompt calls, got ${client.calls.length}`);
}

describe("octto auto-resume integration", () => {
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

  it("prompts the registered owner when a WebSocket answer arrives", async () => {
    const harness = createHarness();
    store = harness.store;
    const conversation = await startConversation(store);
    harness.registry.register(conversation.id, AUTO_RESUME_OWNER_ID);

    answerQuestion(store, conversation);
    await waitForCalls(harness.client, EXPECTED_PROMPT_CALLS);

    expect(store.getSession(conversation.id)?.questions.get(conversation.questionId)?.status).toBe(STATUSES.ANSWERED);
    expect(harness.client.calls).toEqual([
      {
        path: { id: AUTO_RESUME_OWNER_ID },
        body: {
          parts: [
            {
              type: "text",
              text: contractPrompt(conversation.id, conversation.questionId),
            },
          ],
        },
      },
    ]);
  });

  it("does not prompt when no auto-resume owner is registered", async () => {
    const harness = createHarness();
    store = harness.store;
    const conversation = await startConversation(store);

    answerQuestion(store, conversation);

    expect(store.getSession(conversation.id)?.questions.get(conversation.questionId)?.status).toBe(STATUSES.ANSWERED);
    expect(harness.client.calls).toEqual([]);
  });
});
