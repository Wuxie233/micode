import type { PersistedSession } from "@/octto/persistence/schemas";
import { config } from "@/utils/config";

export interface ReconcileReport {
  readonly loaded: number;
  readonly expired: number;
  readonly skippedInvalid: number;
}

interface SessionStore {
  readonly injectPersistedSession: (persisted: PersistedSession) => Promise<void> | void;
}

interface PersistedSessionStore {
  readonly list: () => Promise<readonly string[]>;
  readonly load: (sessionId: string) => Promise<PersistedSession | null>;
  readonly delete: (sessionId: string) => Promise<void>;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

function getTtl(): number {
  return config.octto.persistedSessionTtlHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
}

function isExpired(persisted: PersistedSession, now: number): boolean {
  return now - persisted.updated_at > getTtl();
}

export async function reconcilePersistedSessions(input: {
  readonly store: SessionStore;
  readonly persistedStore: PersistedSessionStore;
  readonly now?: number;
}): Promise<ReconcileReport> {
  let loaded = 0;
  let expired = 0;
  let skippedInvalid = 0;
  const now = input.now ?? Date.now();
  const sessionIds = await input.persistedStore.list();

  for (const sessionId of sessionIds) {
    const persisted = await input.persistedStore.load(sessionId);
    if (!persisted) {
      skippedInvalid += 1;
      continue;
    }

    if (isExpired(persisted, now)) {
      await input.persistedStore.delete(sessionId);
      expired += 1;
      continue;
    }

    await input.store.injectPersistedSession(persisted);
    loaded += 1;
  }

  return { loaded, expired, skippedInvalid };
}
