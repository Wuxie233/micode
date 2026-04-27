import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { PersistedSession } from "@/octto/persistence/schemas";
import { type SessionListeners, safelyInvoke } from "@/octto/session/listeners";
import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import type { Session } from "@/octto/session/types";
import { QUESTIONS, STATUSES, WS_MESSAGES } from "@/octto/session/types";
import { config } from "@/utils/config";

const OWNER = "owner-session";
const TITLE = "Listener session";
const QUESTION_TEXT = "What changed?";
const RESPONSE_TEXT = "Everything";
const PERSISTED_SESSION_ID = "persisted-session";
const PERSISTED_QUESTION_ID = "persisted-question";
const CREATED_AT = 1_772_000_000_000;
const UPDATED_AT = CREATED_AT + 1;
const WARNING = "warning";
const EPHEMERAL_PORT = 0;

function createPersistedSession(): PersistedSession {
  return {
    session_id: PERSISTED_SESSION_ID,
    title: TITLE,
    url: "https://octto.example/s/persisted-session",
    owner_session_id: OWNER,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    questions: [
      {
        id: PERSISTED_QUESTION_ID,
        type: QUESTIONS.ASK_TEXT,
        status: STATUSES.ANSWERED,
        created_at: CREATED_AT,
        answered_at: UPDATED_AT,
        config: { question: QUESTION_TEXT },
        response: { text: RESPONSE_TEXT },
      },
    ],
    auto_resume_owner_session_id: null,
  };
}

describe("session store listeners", () => {
  let store: ReturnType<typeof createSessionStore> | undefined;
  const originalPort = config.octto.port;

  function setPort(port: number): void {
    Object.defineProperty(config.octto, "port", {
      configurable: true,
      value: port,
      writable: true,
    });
  }

  afterEach(async () => {
    await store?.cleanup();
    store = undefined;
    await stopSharedServer();
    setPort(originalPort);
  });

  it("emits listeners through a full session lifecycle", async () => {
    setPort(EPHEMERAL_PORT);
    const events: string[] = [];
    const listeners: SessionListeners = {
      onSessionStarted: (session) => events.push(`started:${session.id}`),
      onQuestionPushed: (session, questionId) => events.push(`pushed:${session.id}:${questionId}`),
      onQuestionAnswered: (session, questionId) => events.push(`answered:${session.id}:${questionId}`),
      onSessionEnded: (sessionId) => events.push(`ended:${sessionId}`),
    };
    store = createSessionStore({ listeners, skipBrowser: true });

    const started = await store.startSession({ ownerSessionID: OWNER, title: TITLE });
    const pushed = store.pushQuestion(started.session_id, QUESTIONS.ASK_TEXT, { question: QUESTION_TEXT });

    store.handleWsMessage(started.session_id, {
      type: WS_MESSAGES.RESPONSE,
      id: pushed.question_id,
      answer: { text: RESPONSE_TEXT },
    });
    await store.endSession(started.session_id);

    expect(events).toEqual([
      `started:${started.session_id}`,
      `pushed:${started.session_id}:${pushed.question_id}`,
      `answered:${started.session_id}:${pushed.question_id}`,
      `ended:${started.session_id}`,
    ]);
  });

  it("rebuilds persisted sessions without firing listeners", async () => {
    setPort(EPHEMERAL_PORT);
    const events: string[] = [];
    const listeners: SessionListeners = {
      onSessionStarted: (session) => events.push(`started:${session.id}`),
      onQuestionPushed: (session, questionId) => events.push(`pushed:${session.id}:${questionId}`),
      onQuestionAnswered: (session, questionId) => events.push(`answered:${session.id}:${questionId}`),
      onSessionEnded: (sessionId) => events.push(`ended:${sessionId}`),
    };
    store = createSessionStore({ listeners, skipBrowser: true });

    store.injectPersistedSession(createPersistedSession());

    expect(events).toEqual([]);
    expect(store.hasSession(PERSISTED_SESSION_ID)).toBe(true);
    expect(store.findSessionIdByQuestion(PERSISTED_QUESTION_ID)).toBe(PERSISTED_SESSION_ID);
    await expect(store.getAnswer({ question_id: PERSISTED_QUESTION_ID })).resolves.toEqual({
      completed: true,
      status: STATUSES.ANSWERED,
      response: { text: RESPONSE_TEXT },
    });
  });
});

describe("safelyInvoke", () => {
  it("swallows listener errors and logs a warning", () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});

    try {
      safelyInvoke(WARNING, () => {
        throw new Error("listener boom");
      });

      expect(warning).toHaveBeenCalledWith("[octto.session.listeners] warning listener failed: listener boom");
    } finally {
      warning.mockRestore();
    }
  });

  it("treats undefined listeners as a no-op", () => {
    const session = { id: "session" } as Session;

    expect(safelyInvoke(WARNING, undefined)).toBeUndefined();
    expect(safelyInvoke(WARNING, () => void session.id)).toBeUndefined();
  });
});
