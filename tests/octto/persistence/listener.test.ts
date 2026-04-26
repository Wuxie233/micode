import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistenceListener } from "@/octto/persistence/listener";
import type { PersistedSession } from "@/octto/persistence/schemas";
import { createPersistedSessionStore } from "@/octto/persistence/store";
import { QUESTIONS, STATUSES } from "@/octto/session";
import type { Question, Session } from "@/octto/session/types";

const PREFIX = "micode-octto-listener-";
const CREATED_AT = 1_776_000_000_000;
const QUESTION_CREATED_AT = CREATED_AT + 1_000;
const ANSWERED_AT = QUESTION_CREATED_AT + 1_000;
const UPDATED_AT = ANSWERED_AT + 1_000;
const SESSION_ID = "session-1";
const OWNER_SESSION_ID = "owner-1";
const SESSION_TITLE = "Octto session";
const SESSION_URL = "https://octto.example/s/session-1";
const QUESTION_ID = "question-1";
const SAVE_ERROR = "save failed";
const DELETE_ERROR = "delete failed";

const createQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: QUESTION_ID,
  sessionId: SESSION_ID,
  type: QUESTIONS.ASK_TEXT,
  status: STATUSES.PENDING,
  createdAt: new Date(QUESTION_CREATED_AT),
  config: {
    question: "What should happen next?",
    multiline: true,
  },
  ...overrides,
});

const createSession = (questions: readonly Question[] = []): Session => ({
  id: SESSION_ID,
  title: SESSION_TITLE,
  url: SESSION_URL,
  createdAt: new Date(CREATED_AT),
  questions: new Map(questions.map((question) => [question.id, question])),
  ownerSessionID: OWNER_SESSION_ID,
  wsConnected: false,
});

const createPersisted = (questions: PersistedSession["questions"] = []): PersistedSession => ({
  session_id: SESSION_ID,
  title: SESSION_TITLE,
  url: SESSION_URL,
  owner_session_id: OWNER_SESSION_ID,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  questions,
  auto_resume_owner_session_id: null,
});

const withNow = async <Value>(time: number, run: () => Promise<Value>): Promise<Value> => {
  const original = Date.now;
  Date.now = () => time;
  try {
    return await run();
  } finally {
    Date.now = original;
  }
};

describe("octto persistence listener", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("writes persisted snapshots for start, push, and answer events", async () => {
    const persistedStore = createPersistedSessionStore({ baseDir });
    const listener = createPersistenceListener({ persistedStore });

    await withNow(UPDATED_AT, async () => listener.onSessionStarted(createSession()));
    await expect(persistedStore.load(SESSION_ID)).resolves.toEqual(createPersisted());

    const pendingQuestion = createQuestion();
    await withNow(UPDATED_AT, async () => listener.onQuestionPushed(createSession([pendingQuestion])));
    await expect(persistedStore.load(SESSION_ID)).resolves.toEqual(
      createPersisted([
        {
          id: QUESTION_ID,
          type: QUESTIONS.ASK_TEXT,
          status: STATUSES.PENDING,
          created_at: QUESTION_CREATED_AT,
          answered_at: null,
          config: pendingQuestion.config,
          response: null,
        },
      ]),
    );

    const answeredQuestion = createQuestion({
      status: STATUSES.ANSWERED,
      answeredAt: new Date(ANSWERED_AT),
      response: { text: "Continue the task." },
    });
    await withNow(UPDATED_AT, async () => listener.onQuestionAnswered(createSession([answeredQuestion])));

    await expect(persistedStore.load(SESSION_ID)).resolves.toEqual(
      createPersisted([
        {
          id: QUESTION_ID,
          type: QUESTIONS.ASK_TEXT,
          status: STATUSES.ANSWERED,
          created_at: QUESTION_CREATED_AT,
          answered_at: ANSWERED_AT,
          config: answeredQuestion.config,
          response: answeredQuestion.response ?? null,
        },
      ]),
    );
  });

  it("swallows save errors and logs a warning", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const listener = createPersistenceListener({
      persistedStore: {
        save: async () => {
          throw new Error(SAVE_ERROR);
        },
        load: async () => null,
        delete: async () => {},
        list: async () => [],
      },
    });

    await expect(listener.onQuestionPushed(createSession())).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
    expect(String(warning.mock.calls[0]?.[0])).toContain(SAVE_ERROR);

    warning.mockRestore();
  });

  it("deletes persisted sessions on end", async () => {
    const persistedStore = createPersistedSessionStore({ baseDir });
    const listener = createPersistenceListener({ persistedStore });

    await persistedStore.save(createPersisted());
    await listener.onSessionEnded(SESSION_ID);

    await expect(persistedStore.load(SESSION_ID)).resolves.toBeNull();
  });

  it("swallows delete errors and logs a warning", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const listener = createPersistenceListener({
      persistedStore: {
        save: async () => {},
        load: async () => null,
        delete: async () => {
          throw new Error(DELETE_ERROR);
        },
        list: async () => [],
      },
    });

    await expect(listener.onSessionEnded(SESSION_ID)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
    expect(String(warning.mock.calls[0]?.[0])).toContain(DELETE_ERROR);

    warning.mockRestore();
  });
});
