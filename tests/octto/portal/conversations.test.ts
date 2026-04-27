import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as v from "valibot";

import { handleConversationQuestions, handleConversationsList } from "@/octto/portal/conversations";
import type { BaseConfig, QuestionType, SessionStore } from "@/octto/session";
import { createSessionStore, QUESTIONS, STATUSES } from "@/octto/session";
import { stopSharedServer } from "@/octto/session/server";
import { config } from "@/utils/config";

const OWNER = "owner-session-1";
const UNKNOWN_CONVERSATION_ID = "missing-conversation";
const OK_STATUS = 200;
const NOT_FOUND_STATUS = 404;
const OLD_PENDING_AGE_MS = 120_000;
const TIED_PENDING_AGE_MS = 60_000;
const RECENT_PENDING_AGE_MS = 15_000;
const OLDER_CREATED_OFFSET_MS = 20_000;
const NEWER_CREATED_OFFSET_MS = 10_000;
const LATEST_CREATED_OFFSET_MS = 1_000;
const EPHEMERAL_PORT = 0;
const ORIGINAL_OCTTO_PORT = config.octto.port;
const CONVERSATION_KEYS = ["id", "title", "createdAt", "pendingCount", "oldestPendingAgeMs", "ownerSessionId"];
const QUESTION_KEYS = ["id", "type", "status", "createdAt", "answeredAt", "config"];

const QuestionTypeMirror = v.picklist(Object.values(QUESTIONS) as readonly QuestionType[]);
const QuestionStatusMirror = v.picklist([STATUSES.PENDING, STATUSES.ANSWERED, STATUSES.CANCELLED, STATUSES.TIMEOUT]);
const ConfigMirror = v.unknown() as v.GenericSchema<unknown, BaseConfig>;

const ConversationSummaryMirror = v.object({
  id: v.string(),
  title: v.nullable(v.string()),
  createdAt: v.string(),
  pendingCount: v.number(),
  oldestPendingAgeMs: v.nullable(v.number()),
  ownerSessionId: v.string(),
});

const ConversationsMirror = v.object({
  conversations: v.array(ConversationSummaryMirror),
});

const QuestionSummaryMirror = v.object({
  id: v.string(),
  type: QuestionTypeMirror,
  status: QuestionStatusMirror,
  createdAt: v.string(),
  answeredAt: v.nullable(v.string()),
  config: ConfigMirror,
});

const ConversationQuestionsMirror = v.object({
  conversationId: v.string(),
  questions: v.array(QuestionSummaryMirror),
});

const ConversationNotFoundMirror = v.object({
  error: v.literal("ConversationNotFound"),
  conversationId: v.string(),
});

interface ConversationHandle {
  readonly id: string;
  readonly questionIds: readonly string[];
}

async function parseJson<T>(response: Response, schema: v.GenericSchema<unknown, T>): Promise<T> {
  const raw: unknown = await response.json();
  return v.parse(schema, raw);
}

function expectExactKeys(value: object, keys: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual(Array.from(keys).sort());
}

function defineDate(target: object, key: "createdAt" | "answeredAt", date: Date): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value: date,
    writable: true,
  });
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    enumerable: true,
    value: port,
    writable: true,
  });
}

function requireQuestionId(handle: ConversationHandle, index: number): string {
  const questionId = handle.questionIds[index];
  if (questionId) return questionId;
  throw new Error(`Missing question at index ${index}`);
}

function setConversationCreatedAt(store: SessionStore, conversationId: string, createdAt: Date): void {
  const conversation = store.getSession(conversationId);
  if (!conversation) throw new Error(`Missing conversation ${conversationId}`);
  defineDate(conversation, "createdAt", createdAt);
}

function setQuestionCreatedAt(store: SessionStore, conversationId: string, questionId: string, createdAt: Date): void {
  const question = store.getSession(conversationId)?.questions.get(questionId);
  if (!question) throw new Error(`Missing question ${questionId}`);
  defineDate(question, "createdAt", createdAt);
}

async function startConversation(
  store: SessionStore,
  title: string,
  createdAt: Date,
  pendingAgeMs: number,
): Promise<ConversationHandle> {
  const output = await store.startSession({
    ownerSessionID: OWNER,
    title,
    questions: [{ type: QUESTIONS.ASK_TEXT, config: { question: title } }],
  });
  const questionIds = output.question_ids ?? [];
  const questionId = requireQuestionId({ id: output.session_id, questionIds }, 0);

  setConversationCreatedAt(store, output.session_id, createdAt);
  setQuestionCreatedAt(store, output.session_id, questionId, new Date(Date.now() - pendingAgeMs));

  return { id: output.session_id, questionIds };
}

describe("octto portal conversation handlers", () => {
  let store: SessionStore;

  beforeEach(() => {
    setOcttoPort(EPHEMERAL_PORT);
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
    setOcttoPort(ORIGINAL_OCTTO_PORT);
  });

  it("returns an empty conversations list for an empty store", async () => {
    const response = handleConversationsList(store);
    const payload = await parseJson(response, ConversationsMirror);

    expect(response.status).toBe(OK_STATUS);
    expect(payload).toEqual({ conversations: [] });
  });

  it("returns the exact two-question contract shape for a conversation", async () => {
    const firstConfig = { question: "What should happen next?", multiline: true };
    const secondConfig = { question: "Proceed?", allowCancel: true };
    const output = await store.startSession({
      ownerSessionID: OWNER,
      title: "Support thread",
      questions: [
        { type: QUESTIONS.ASK_TEXT, config: firstConfig },
        { type: QUESTIONS.CONFIRM, config: secondConfig },
      ],
    });
    const firstId = requireQuestionId({ id: output.session_id, questionIds: output.question_ids ?? [] }, 0);
    store.handleWsMessage(output.session_id, { type: "response", id: firstId, answer: { text: "Continue" } });

    const response = handleConversationQuestions(store, output.session_id);
    const payload = await parseJson(response, ConversationQuestionsMirror);

    expect(response.status).toBe(OK_STATUS);
    expectExactKeys(payload, ["conversationId", "questions"]);
    expect(payload.conversationId).toBe(output.session_id);
    expect(payload.questions).toHaveLength(2);
    for (const question of payload.questions) expectExactKeys(question, QUESTION_KEYS);
    expect(payload.questions.map((question) => question.config)).toEqual([firstConfig, secondConfig]);
    expect(payload.questions.map((question) => question.answeredAt)).toContain(null);
    expect(
      payload.questions.some((question) => question.status === STATUSES.ANSWERED && question.answeredAt !== null),
    ).toBe(true);
  });

  it("returns a contract-shaped 404 for an unknown conversation", async () => {
    const response = handleConversationQuestions(store, UNKNOWN_CONVERSATION_ID);
    const payload = await parseJson(response, ConversationNotFoundMirror);

    expect(response.status).toBe(NOT_FOUND_STATUS);
    expect(payload).toEqual({ error: "ConversationNotFound", conversationId: UNKNOWN_CONVERSATION_ID });
  });

  it("sorts conversations by pending age, created time, and zero pending bottom", async () => {
    const now = Date.now();
    const oldestPending = await startConversation(
      store,
      "oldest pending",
      new Date(now - OLDER_CREATED_OFFSET_MS),
      OLD_PENDING_AGE_MS,
    );
    const tiedOlder = await startConversation(
      store,
      "tied older",
      new Date(now - OLDER_CREATED_OFFSET_MS),
      TIED_PENDING_AGE_MS,
    );
    const tiedNewer = await startConversation(
      store,
      "tied newer",
      new Date(now - NEWER_CREATED_OFFSET_MS),
      TIED_PENDING_AGE_MS,
    );
    const answered = await startConversation(
      store,
      "answered",
      new Date(now - LATEST_CREATED_OFFSET_MS),
      RECENT_PENDING_AGE_MS,
    );

    store.handleWsMessage(answered.id, {
      type: "response",
      id: requireQuestionId(answered, 0),
      answer: { text: "Done" },
    });

    const response = handleConversationsList(store);
    const payload = await parseJson(response, ConversationsMirror);

    expect(response.status).toBe(OK_STATUS);
    for (const conversation of payload.conversations) expectExactKeys(conversation, CONVERSATION_KEYS);
    expect(payload.conversations.map((conversation) => conversation.id)).toEqual([
      oldestPending.id,
      tiedNewer.id,
      tiedOlder.id,
      answered.id,
    ]);
    expect(payload.conversations.at(-1)?.pendingCount).toBe(0);
    expect(payload.conversations.at(-1)?.oldestPendingAgeMs).toBeNull();
  });
});
