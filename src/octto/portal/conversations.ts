import type { BaseConfig, QuestionType, SessionStore } from "@/octto/session";
import { STATUSES } from "@/octto/session";
import type { Question, QuestionStatus, Session } from "@/octto/session/types";

interface ConversationSummary {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly pendingCount: number;
  readonly oldestPendingAgeMs: number | null;
  readonly ownerSessionId: string;
}

interface ConversationsResponse {
  readonly conversations: readonly ConversationSummary[];
}

interface QuestionSummary {
  readonly id: string;
  readonly type: QuestionType;
  readonly status: QuestionStatus;
  readonly createdAt: string;
  readonly answeredAt: string | null;
  readonly config: BaseConfig;
}

interface ConversationQuestionsResponse {
  readonly conversationId: string;
  readonly questions: readonly QuestionSummary[];
}

interface ConversationNotFoundResponse {
  readonly error: "ConversationNotFound";
  readonly conversationId: string;
}

interface PendingSummary {
  readonly pendingCount: number;
  readonly oldestPendingAgeMs: number | null;
}

interface SortableConversation {
  readonly summary: ConversationSummary;
  readonly createdAtMs: number;
}

const OK_STATUS = 200;
const NOT_FOUND_STATUS = 404;
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function toJsonResponse(payload: unknown, status = OK_STATUS): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function isSession(session: Session | undefined): session is Session {
  return session !== undefined;
}

function collectSessions(store: SessionStore): Session[] {
  const ids = new Set<string>();

  for (const question of store.listQuestions().questions) {
    const id = store.findSessionIdByQuestion(question.id);
    if (id) ids.add(id);
  }

  return Array.from(ids)
    .map((id) => store.getSession(id))
    .filter(isSession);
}

function summarizePending(session: Session, now: number): PendingSummary {
  let pendingCount = 0;
  let oldestPendingAgeMs: number | null = null;

  for (const question of session.questions.values()) {
    if (question.status !== STATUSES.PENDING) continue;

    pendingCount += 1;
    const ageMs = Math.max(0, now - question.createdAt.getTime());
    oldestPendingAgeMs = Math.max(oldestPendingAgeMs ?? 0, ageMs);
  }

  return { pendingCount, oldestPendingAgeMs };
}

function toConversation(session: Session, now: number): SortableConversation {
  const pending = summarizePending(session, now);
  return {
    summary: {
      id: session.id,
      title: session.title ?? null,
      createdAt: session.createdAt.toISOString(),
      pendingCount: pending.pendingCount,
      oldestPendingAgeMs: pending.oldestPendingAgeMs,
      ownerSessionId: session.ownerSessionID,
    },
    createdAtMs: session.createdAt.getTime(),
  };
}

function compareConversations(left: SortableConversation, right: SortableConversation): number {
  const leftAge = left.summary.oldestPendingAgeMs;
  const rightAge = right.summary.oldestPendingAgeMs;

  if (leftAge === null && rightAge !== null) return 1;
  if (leftAge !== null && rightAge === null) return -1;
  if (leftAge !== null && rightAge !== null && leftAge !== rightAge) return rightAge - leftAge;

  return right.createdAtMs - left.createdAtMs;
}

function toQuestion(question: Question): QuestionSummary {
  return {
    id: question.id,
    type: question.type,
    status: question.status,
    createdAt: question.createdAt.toISOString(),
    answeredAt: question.answeredAt?.toISOString() ?? null,
    config: question.config,
  };
}

function notFound(conversationId: string): Response {
  const payload: ConversationNotFoundResponse = { error: "ConversationNotFound", conversationId };
  return toJsonResponse(payload, NOT_FOUND_STATUS);
}

// eslint-disable-next-line no-restricted-syntax -- Frozen contract requires the public export name handleConversationsList.
export function handleConversationsList(store: SessionStore): Response {
  const now = Date.now();
  const conversations = collectSessions(store)
    .map((session) => toConversation(session, now))
    .sort(compareConversations)
    .map((conversation) => conversation.summary);
  const payload: ConversationsResponse = { conversations };

  return toJsonResponse(payload);
}

export function handleConversationQuestions(store: SessionStore, conversationId: string): Response {
  const session = store.getSession(conversationId);
  if (!session) return notFound(conversationId);

  const payload: ConversationQuestionsResponse = {
    conversationId,
    questions: Array.from(session.questions.values()).map(toQuestion),
  };

  return toJsonResponse(payload);
}
