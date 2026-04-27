// src/octto/session/sessions.ts
import type { ServerWebSocket } from "bun";

import { DEFAULT_ANSWER_TIMEOUT_MS } from "@/octto/constants";
import type { PersistedQuestion, PersistedSession } from "@/octto/persistence/schemas";
import { config } from "@/utils/config";
import { log } from "@/utils/logger";
import { openBrowser } from "./browser";
import { OcttoForbiddenError } from "./errors";
import { type SessionListeners, safelyInvoke } from "./listeners";
import { getSharedServer } from "./server";
import {
  type Answer,
  type BaseConfig,
  type EndSessionOutput,
  type GetAnswerInput,
  type GetAnswerOutput,
  type GetNextAnswerInput,
  type GetNextAnswerOutput,
  type ListQuestionsOutput,
  type PushQuestionOutput,
  type Question,
  type QuestionType,
  type Session,
  STATUSES,
  type StartSessionInput,
  type StartSessionOutput,
  WS_MESSAGES,
  type WsClientMessage,
  type WsServerMessage,
} from "./types";
import { generateQuestionId, generateSessionId } from "./utils";
import { createWaiters } from "./waiter";

export interface SessionStoreOptions {
  listeners?: SessionListeners;
  /** Skip opening browser - useful for tests */
  skipBrowser?: boolean;
}

export interface SessionStore {
  startSession: (input: StartSessionInput) => Promise<StartSessionOutput>;
  endSession: (sessionId: string) => Promise<EndSessionOutput>;
  pushQuestion: (sessionId: string, type: QuestionType, config: BaseConfig) => PushQuestionOutput;
  getAnswer: (input: GetAnswerInput) => Promise<GetAnswerOutput>;
  getNextAnswer: (input: GetNextAnswerInput) => Promise<GetNextAnswerOutput>;
  cancelQuestion: (questionId: string) => { ok: boolean };
  listQuestions: (sessionId?: string) => ListQuestionsOutput;
  handleWsConnect: (sessionId: string, ws: ServerWebSocket<unknown>) => void;
  handleWsDisconnect: (sessionId: string) => void;
  handleWsMessage: (sessionId: string, message: WsClientMessage) => void;
  injectPersistedSession: (persisted: PersistedSession) => void;
  getSession: (sessionId: string) => Session | undefined;
  hasSession: (id: string) => boolean;
  findSessionIdByQuestion: (questionId: string) => string | undefined;
  assertOwner: (sessionId: string, ownerSessionID: string) => void;
  isOwner: (sessionId: string, ownerSessionID: string) => boolean;
  listOwnedSessions: (ownerSessionID: string) => string[];
  cleanup: () => Promise<void>;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const sessions = new Map<string, Session>();
  const questionToSession = new Map<string, string>();
  const rw = createWaiters<string, Answer | { cancelled: true }>();
  const sw = createWaiters<string, { questionId: string; response: Answer }>();

  const store: SessionStore = {
    startSession: (input) => initSession(sessions, questionToSession, store, input, options),
    endSession: (id) => teardownSession(sessions, questionToSession, rw, id, options),
    pushQuestion: (id, type, cfg) => pushNewQuestion(sessions, questionToSession, id, type, cfg, options),
    getAnswer: (input) => resolveAnswer(sessions, questionToSession, rw, input),
    getNextAnswer: (input) => resolveNextAnswer(sessions, sw, input),
    cancelQuestion: (id) => cancelPendingQuestion(sessions, questionToSession, rw, id),
    listQuestions: (id) => collectQuestions(sessions, id),
    handleWsConnect: (id, ws) => onWsConnect(sessions, id, ws),
    handleWsDisconnect: (id) => onWsDisconnect(sessions, id),
    handleWsMessage: (id, msg) => onWsMessage(sessions, rw, sw, id, msg, options),
    injectPersistedSession: (persisted) => injectPersistedSession(sessions, questionToSession, persisted),
    getSession: (id) => sessions.get(id),
    hasSession: (id) => sessions.has(id),
    findSessionIdByQuestion: (id) => questionToSession.get(id),
    assertOwner: (id, owner) => assertSessionOwner(sessions, id, owner),
    isOwner: (id, owner) => isSessionOwner(sessions, id, owner),
    listOwnedSessions: (owner) => collectOwnedSessionIds(sessions, owner),
    cleanup: async () => {
      for (const id of Array.from(sessions.keys())) await store.endSession(id);
    },
  };
  return store;
}

const LISTENER_LABELS = {
  SESSION_STARTED: "onSessionStarted",
  QUESTION_PUSHED: "onQuestionPushed",
  QUESTION_ANSWERED: "onQuestionAnswered",
  SESSION_ENDED: "onSessionEnded",
} as const;

async function initSession(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  store: SessionStore,
  input: StartSessionInput,
  options: SessionStoreOptions,
): Promise<StartSessionOutput> {
  const sessionId = generateSessionId();
  const { port } = await getSharedServer(store);
  const url = config.octto.publicBaseUrl
    ? `${config.octto.publicBaseUrl}/s/${sessionId}`
    : `http://127.0.0.1:${port}/s/${sessionId}`;

  const session: Session = {
    id: sessionId,
    title: input.title,
    url,
    createdAt: new Date(),
    questions: new Map(),
    ownerSessionID: input.ownerSessionID,
    wsConnected: false,
  };
  sessions.set(sessionId, session);

  const questionIds = registerInitialQuestions(session, questionToSession, input);

  if (!options.skipBrowser) {
    await openBrowser(url).catch(async (error: unknown) => {
      sessions.delete(sessionId);
      for (const qId of questionIds) questionToSession.delete(qId);
      throw error;
    });
  }

  safelyInvoke(LISTENER_LABELS.SESSION_STARTED, () => options.listeners?.onSessionStarted?.(session));

  return {
    session_id: sessionId,
    url,
    question_ids: questionIds.length > 0 ? questionIds : undefined,
  };
}

function registerInitialQuestions(
  session: Session,
  questionToSession: Map<string, string>,
  input: StartSessionInput,
): string[] {
  return (input.questions ?? []).map((q) => {
    const questionId = generateQuestionId();
    const question: Question = {
      id: questionId,
      sessionId: session.id,
      type: q.type,
      config: q.config,
      status: STATUSES.PENDING,
      createdAt: new Date(),
    };
    session.questions.set(questionId, question);
    questionToSession.set(questionId, session.id);
    return questionId;
  });
}

function injectPersistedSession(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  persisted: PersistedSession,
): void {
  const previous = sessions.get(persisted.session_id);
  if (previous) removeQuestionIndexes(previous, questionToSession);

  const session = restoreSession(persisted);
  for (const questionId of session.questions.keys()) questionToSession.set(questionId, session.id);
  sessions.set(session.id, session);
}

function removeQuestionIndexes(session: Session, questionToSession: Map<string, string>): void {
  for (const questionId of session.questions.keys()) questionToSession.delete(questionId);
}

function restoreSession(persisted: PersistedSession): Session {
  const questions = new Map<string, Question>();
  for (const persistedQuestion of persisted.questions) {
    const question = restoreQuestion(persisted.session_id, persistedQuestion);
    questions.set(question.id, question);
  }

  return {
    id: persisted.session_id,
    title: persisted.title ?? undefined,
    url: persisted.url,
    createdAt: new Date(persisted.created_at),
    questions,
    ownerSessionID: persisted.owner_session_id,
    wsConnected: false,
  };
}

function restoreQuestion(sessionId: string, persisted: PersistedQuestion): Question {
  const question: Question = {
    id: persisted.id,
    sessionId,
    type: persisted.type,
    config: persisted.config,
    status: persisted.status,
    createdAt: new Date(persisted.created_at),
  };

  if (persisted.answered_at !== null) question.answeredAt = new Date(persisted.answered_at);
  if (persisted.response !== null) question.response = persisted.response;

  return question;
}

async function teardownSession(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  responseWaiters: ReturnType<typeof createWaiters<string, Answer | { cancelled: true }>>,
  sessionId: string,
  options: SessionStoreOptions,
): Promise<EndSessionOutput> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false };

  if (session.wsClient) {
    const msg: WsServerMessage = { type: WS_MESSAGES.END };
    session.wsClient.send(JSON.stringify(msg));
  }

  for (const questionId of session.questions.keys()) {
    questionToSession.delete(questionId);
    responseWaiters.clear(questionId);
  }

  sessions.delete(sessionId);
  safelyInvoke(LISTENER_LABELS.SESSION_ENDED, () => options.listeners?.onSessionEnded?.(sessionId));
  return { ok: true };
}

function assertSessionOwner(sessions: Map<string, Session>, sessionId: string, ownerSessionID: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.ownerSessionID === ownerSessionID) return;

  throw new OcttoForbiddenError(sessionId, session.ownerSessionID, ownerSessionID);
}

function isSessionOwner(sessions: Map<string, Session>, sessionId: string, ownerSessionID: string): boolean {
  return sessions.get(sessionId)?.ownerSessionID === ownerSessionID;
}

function collectOwnedSessionIds(sessions: Map<string, Session>, ownerSessionID: string): string[] {
  return Array.from(sessions.values())
    .filter((session) => session.ownerSessionID === ownerSessionID)
    .map((session) => session.id);
}

function pushNewQuestion(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  sessionId: string,
  type: QuestionType,
  config: BaseConfig,
  options: SessionStoreOptions,
): PushQuestionOutput {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const questionId = generateQuestionId();
  const question: Question = {
    id: questionId,
    sessionId,
    type,
    config,
    status: STATUSES.PENDING,
    createdAt: new Date(),
  };

  session.questions.set(questionId, question);
  questionToSession.set(questionId, sessionId);

  if (session.wsConnected && session.wsClient) {
    const msg: WsServerMessage = { type: WS_MESSAGES.QUESTION, id: questionId, questionType: type, config };
    session.wsClient.send(JSON.stringify(msg));
  } else if (!options.skipBrowser) {
    openBrowser(session.url).catch((e: unknown) => log.error("octto", "Failed to open browser", e));
  }

  safelyInvoke(LISTENER_LABELS.QUESTION_PUSHED, () => options.listeners?.onQuestionPushed?.(session, questionId));

  return { question_id: questionId };
}

async function resolveAnswer(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  responseWaiters: ReturnType<typeof createWaiters<string, Answer | { cancelled: true }>>,
  input: GetAnswerInput,
): Promise<GetAnswerOutput> {
  const sessionId = questionToSession.get(input.question_id);
  if (!sessionId) return { completed: false, status: STATUSES.CANCELLED, reason: STATUSES.CANCELLED };

  const session = sessions.get(sessionId);
  if (!session) return { completed: false, status: STATUSES.CANCELLED, reason: STATUSES.CANCELLED };

  const question = session.questions.get(input.question_id);
  if (!question) return { completed: false, status: STATUSES.CANCELLED, reason: STATUSES.CANCELLED };

  if (question.status === STATUSES.ANSWERED) {
    return { completed: true, status: STATUSES.ANSWERED, response: question.response };
  }
  if (question.status === STATUSES.CANCELLED || question.status === STATUSES.TIMEOUT) {
    return { completed: false, status: question.status, reason: question.status };
  }
  if (!input.block) {
    return { completed: false, status: STATUSES.PENDING, reason: STATUSES.PENDING };
  }

  return waitForAnswer(responseWaiters, input);
}

function waitForAnswer(
  responseWaiters: ReturnType<typeof createWaiters<string, Answer | { cancelled: true }>>,
  input: GetAnswerInput,
): Promise<GetAnswerOutput> {
  const timeout = input.timeout ?? DEFAULT_ANSWER_TIMEOUT_MS;

  return new Promise<GetAnswerOutput>((resolve) => {
    // eslint-disable-next-line prefer-const
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = responseWaiters.register(input.question_id, (response) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (response && typeof response === "object" && "cancelled" in response) {
        resolve({ completed: false, status: STATUSES.CANCELLED, reason: STATUSES.CANCELLED });
      } else {
        resolve({ completed: true, status: STATUSES.ANSWERED, response });
      }
    });

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ completed: false, status: STATUSES.TIMEOUT, reason: STATUSES.TIMEOUT });
    }, timeout);
  });
}

async function resolveNextAnswer(
  sessions: Map<string, Session>,
  sessionWaiters: ReturnType<typeof createWaiters<string, { questionId: string; response: Answer }>>,
  input: GetNextAnswerInput,
): Promise<GetNextAnswerOutput> {
  const session = sessions.get(input.session_id);
  if (!session) return { completed: false, status: STATUSES.NONE_PENDING, reason: STATUSES.NONE_PENDING };

  // Check for already-answered, unretrieved questions
  const unretrieved = findUnretrievedAnswer(session);
  if (unretrieved) return unretrieved;

  const hasPending = Array.from(session.questions.values()).some((q) => q.status === STATUSES.PENDING);
  if (!hasPending) return { completed: false, status: STATUSES.NONE_PENDING, reason: STATUSES.NONE_PENDING };
  if (!input.block) return { completed: false, status: STATUSES.PENDING };

  return waitForNextAnswer(session, sessionWaiters, input);
}

function findUnretrievedAnswer(session: Session): GetNextAnswerOutput | null {
  for (const question of session.questions.values()) {
    if (question.status === STATUSES.ANSWERED && !question.retrieved) {
      question.retrieved = true;
      return {
        completed: true,
        question_id: question.id,
        question_type: question.type,
        status: STATUSES.ANSWERED,
        response: question.response,
      };
    }
  }
  return null;
}

function waitForNextAnswer(
  session: Session,
  sessionWaiters: ReturnType<typeof createWaiters<string, { questionId: string; response: Answer }>>,
  input: GetNextAnswerInput,
): Promise<GetNextAnswerOutput> {
  const timeout = input.timeout ?? DEFAULT_ANSWER_TIMEOUT_MS;

  return new Promise<GetNextAnswerOutput>((resolve) => {
    // eslint-disable-next-line prefer-const
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = sessionWaiters.register(input.session_id, ({ questionId, response }) => {
      if (timeoutId) clearTimeout(timeoutId);
      const question = session.questions.get(questionId);
      if (question) question.retrieved = true;
      resolve({
        completed: true,
        question_id: questionId,
        question_type: question?.type,
        status: STATUSES.ANSWERED,
        response,
      });
    });

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ completed: false, status: STATUSES.TIMEOUT, reason: STATUSES.TIMEOUT });
    }, timeout);
  });
}

function cancelPendingQuestion(
  sessions: Map<string, Session>,
  questionToSession: Map<string, string>,
  responseWaiters: ReturnType<typeof createWaiters<string, Answer | { cancelled: true }>>,
  questionId: string,
): { ok: boolean } {
  const sessionId = questionToSession.get(questionId);
  if (!sessionId) return { ok: false };

  const session = sessions.get(sessionId);
  if (!session) return { ok: false };

  const question = session.questions.get(questionId);
  if (!question || question.status !== STATUSES.PENDING) return { ok: false };

  question.status = STATUSES.CANCELLED;

  if (session.wsClient) {
    const msg: WsServerMessage = { type: WS_MESSAGES.CANCEL, id: questionId };
    session.wsClient.send(JSON.stringify(msg));
  }

  responseWaiters.notifyAll(questionId, { cancelled: true });
  return { ok: true };
}

function collectQuestions(sessions: Map<string, Session>, sessionId?: string): ListQuestionsOutput {
  const questions: ListQuestionsOutput["questions"] = [];
  const sessionsToCheck = sessionId ? [sessions.get(sessionId)].filter(Boolean) : Array.from(sessions.values());

  for (const session of sessionsToCheck) {
    if (!session) continue;
    for (const question of session.questions.values()) {
      questions.push({
        id: question.id,
        type: question.type,
        status: question.status,
        createdAt: question.createdAt.toISOString(),
        answeredAt: question.answeredAt?.toISOString(),
      });
    }
  }

  questions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { questions };
}

function onWsConnect(sessions: Map<string, Session>, sessionId: string, ws: ServerWebSocket<unknown>): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.wsConnected = true;
  session.wsClient = ws;

  for (const question of session.questions.values()) {
    if (question.status === STATUSES.PENDING) {
      const msg: WsServerMessage = {
        type: WS_MESSAGES.QUESTION,
        id: question.id,
        questionType: question.type,
        config: question.config,
      };
      ws.send(JSON.stringify(msg));
    }
  }
}

function onWsDisconnect(sessions: Map<string, Session>, sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.wsConnected = false;
  session.wsClient = undefined;
}

function onWsMessage(
  sessions: Map<string, Session>,
  responseWaiters: ReturnType<typeof createWaiters<string, Answer | { cancelled: true }>>,
  sessionWaiters: ReturnType<typeof createWaiters<string, { questionId: string; response: Answer }>>,
  sessionId: string,
  message: WsClientMessage,
  options: SessionStoreOptions,
): void {
  if (message.type === WS_MESSAGES.CONNECTED) return;
  if (message.type !== WS_MESSAGES.RESPONSE) return;

  const session = sessions.get(sessionId);
  if (!session) return;

  const question = session.questions.get(message.id);
  if (!question || question.status !== STATUSES.PENDING) return;

  question.status = STATUSES.ANSWERED;
  question.answeredAt = new Date();
  question.response = message.answer;

  safelyInvoke(LISTENER_LABELS.QUESTION_ANSWERED, () => options.listeners?.onQuestionAnswered?.(session, message.id));

  responseWaiters.notifyAll(message.id, message.answer);
  sessionWaiters.notifyFirst(sessionId, {
    questionId: message.id,
    response: message.answer,
  });
}
