import { describe, expect, it } from "bun:test";
import { reconcilePersistedSessions } from "@/octto/persistence/reconcile";
import type { PersistedSession } from "@/octto/persistence/schemas";
import { config } from "@/utils/config";

const NOW = 1_776_000_000_000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

function ttl(): number {
  return config.octto.persistedSessionTtlHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
}

function createSession(sessionId: string, updatedAt: number): PersistedSession {
  return {
    session_id: sessionId,
    title: `Session ${sessionId}`,
    url: `https://octto.example/s/${sessionId}`,
    owner_session_id: "owner-1",
    created_at: NOW,
    updated_at: updatedAt,
    questions: [],
    auto_resume_owner_session_id: null,
  };
}

function createStore(): {
  readonly injected: PersistedSession[];
  readonly injectPersistedSession: (persisted: PersistedSession) => void;
} {
  const injected: PersistedSession[] = [];

  return {
    injected,
    injectPersistedSession: (persisted) => {
      injected.push(persisted);
    },
  };
}

function createPersistedStore(entries: Readonly<Record<string, PersistedSession | null>>): {
  readonly deleted: string[];
  readonly list: () => Promise<string[]>;
  readonly load: (sessionId: string) => Promise<PersistedSession | null>;
  readonly delete: (sessionId: string) => Promise<void>;
} {
  const sessions = new Map<string, PersistedSession | null>(Object.entries(entries));
  const deleted: string[] = [];

  return {
    deleted,
    list: async () => Array.from(sessions.keys()),
    load: async (sessionId) => sessions.get(sessionId) ?? null,
    delete: async (sessionId) => {
      deleted.push(sessionId);
      sessions.delete(sessionId);
    },
  };
}

describe("reconcilePersistedSessions", () => {
  it("loads valid sessions, deletes expired sessions, and skips invalid entries", async () => {
    const loadedA = createSession("loaded-a", NOW - MS_PER_SECOND);
    const loadedB = createSession("loaded-b", NOW);
    const expired = createSession("expired", NOW - ttl() - MS_PER_SECOND);
    const store = createStore();
    const persistedStore = createPersistedStore({
      "loaded-a": loadedA,
      "loaded-b": loadedB,
      expired,
      invalid: null,
    });

    const report = await reconcilePersistedSessions({ store, persistedStore, now: NOW });

    expect(report).toEqual({ loaded: 2, expired: 1, skippedInvalid: 1 });
    expect(store.injected.map((session) => session.session_id)).toEqual(["loaded-a", "loaded-b"]);
    expect(persistedStore.deleted).toEqual(["expired"]);
  });

  it("returns zero counts when there are no persisted sessions", async () => {
    const store = createStore();
    const persistedStore = createPersistedStore({});

    const report = await reconcilePersistedSessions({ store, persistedStore, now: NOW });

    expect(report).toEqual({ loaded: 0, expired: 0, skippedInvalid: 0 });
    expect(store.injected).toEqual([]);
    expect(persistedStore.deleted).toEqual([]);
  });
});
