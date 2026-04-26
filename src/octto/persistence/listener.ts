import type { Question, Session } from "@/octto/session/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { PersistedQuestion, PersistedSession } from "./schemas";
import type { PersistedSessionStore } from "./store";

export interface PersistenceListener {
  readonly onSessionStarted: (session: Session) => Promise<void>;
  readonly onQuestionPushed: (session: Session) => Promise<void>;
  readonly onQuestionAnswered: (session: Session) => Promise<void>;
  readonly onSessionEnded: (sessionId: string) => Promise<void>;
}

export interface PersistenceListenerOptions {
  readonly persistedStore: PersistedSessionStore;
}

type Operation = () => Promise<void>;

const LOG_SCOPE = "octto.persistence";
const SAVE_WARNING = "Failed to persist Octto session";
const DELETE_WARNING = "Failed to delete persisted Octto session";

const toTimestamp = (date: Date | undefined): number | null => date?.getTime() ?? null;

const toPersistedQuestion = (question: Question): PersistedQuestion => ({
  id: question.id,
  type: question.type,
  status: question.status,
  created_at: question.createdAt.getTime(),
  answered_at: toTimestamp(question.answeredAt),
  config: question.config,
  response: question.response ?? null,
});

const toPersisted = (session: Session): PersistedSession => ({
  session_id: session.id,
  title: session.title ?? null,
  url: session.url,
  owner_session_id: session.ownerSessionID,
  created_at: session.createdAt.getTime(),
  updated_at: Date.now(),
  questions: Array.from(session.questions.values(), toPersistedQuestion),
  auto_resume_owner_session_id: null,
});

const saveSession = async (persistedStore: PersistedSessionStore, session: Session): Promise<void> => {
  try {
    await persistedStore.save(toPersisted(session));
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${SAVE_WARNING}: ${extractErrorMessage(error)}`);
  }
};

const deleteSession = async (persistedStore: PersistedSessionStore, sessionId: string): Promise<void> => {
  try {
    await persistedStore.delete(sessionId);
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${DELETE_WARNING}: ${extractErrorMessage(error)}`);
  }
};

function createQueue(): (sessionId: string, operation: Operation) => Promise<void> {
  const queues = new Map<string, Promise<void>>();

  return (sessionId, operation) => {
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (queues.get(sessionId) === next) queues.delete(sessionId);
      });

    queues.set(sessionId, next);
    return next;
  };
}

export function createPersistenceListener({ persistedStore }: PersistenceListenerOptions): PersistenceListener {
  const enqueue = createQueue();

  return {
    onSessionStarted: (session) => enqueue(session.id, () => saveSession(persistedStore, session)),
    onQuestionPushed: (session) => enqueue(session.id, () => saveSession(persistedStore, session)),
    onQuestionAnswered: (session) => enqueue(session.id, () => saveSession(persistedStore, session)),
    onSessionEnded: (sessionId) => enqueue(sessionId, () => deleteSession(persistedStore, sessionId)),
  };
}
