import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPersistedSessionStore,
  createPersistenceListener,
  type PersistedSessionStore,
  reconcilePersistedSessions,
} from "@/octto/persistence";
import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { QUESTIONS, STATUSES } from "@/octto/session/types";
import { config } from "@/utils/config";

const PREFIX = "micode-octto-persistence-index-";
const OWNER_SESSION_ID = "owner-1";
const TITLE = "Persisted Octto session";
const QUESTION = "What should happen next?";
const EPHEMERAL_PORT = 0;
const FIRST_SAVE = 1;
const EXPECTED_SAVE_TOTAL = 2;

interface Gate {
  readonly wait: () => Promise<void>;
  readonly release: () => void;
}

interface Tracker {
  readonly complete: () => void;
  readonly waitForSaves: (expected: number) => Promise<void>;
}

interface DelayedStore {
  readonly store: PersistedSessionStore;
  readonly waitForBlockedSave: () => Promise<void>;
  readonly releaseFirstSave: () => void;
  readonly waitForSaves: (expected: number) => Promise<void>;
}

function createGate(): Gate {
  let release = (): void => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    wait: () => pending,
    release,
  };
}

function createTracker(): Tracker {
  let completed = 0;
  const waiters: Array<() => void> = [];

  return {
    complete: () => {
      completed += 1;
      const pending = waiters.splice(0);
      for (const waiter of pending) waiter();
    },
    waitForSaves: async (expected) => {
      while (completed < expected) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
}

function createDelayedFirstSaveStore(persistedStore: PersistedSessionStore): DelayedStore {
  const hold = createGate();
  const blocked = createGate();
  const tracker = createTracker();
  let attempts = 0;

  return {
    store: {
      save: async (session) => {
        attempts += 1;
        if (attempts === FIRST_SAVE) {
          blocked.release();
          await hold.wait();
        }

        await persistedStore.save(session);
        tracker.complete();
      },
      load: persistedStore.load,
      delete: persistedStore.delete,
      list: persistedStore.list,
    },
    waitForBlockedSave: blocked.wait,
    releaseFirstSave: hold.release,
    waitForSaves: tracker.waitForSaves,
  };
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    value: port,
    writable: true,
  });
}

describe("octto persistence barrel", () => {
  let baseDir: string;
  let live: ReturnType<typeof createSessionStore> | undefined;
  let restored: ReturnType<typeof createSessionStore> | undefined;
  let originalPort: number;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    originalPort = config.octto.port;
    setOcttoPort(EPHEMERAL_PORT);
  });

  afterEach(async () => {
    await restored?.cleanup();
    restored = undefined;
    await live?.cleanup();
    live = undefined;
    await stopSharedServer();
    setOcttoPort(originalPort);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("composes persisted store, listener, and reconcile through the injection contract", async () => {
    const persistedStore = createPersistedSessionStore({ baseDir });
    const delayed = createDelayedFirstSaveStore(persistedStore);
    const listener = createPersistenceListener({ persistedStore: delayed.store });
    live = createSessionStore({ skipBrowser: true, listeners: listener });

    const started = await live.startSession({ ownerSessionID: OWNER_SESSION_ID, title: TITLE });
    await delayed.waitForBlockedSave();
    const pushed = live.pushQuestion(started.session_id, QUESTIONS.ASK_TEXT, { question: QUESTION });
    delayed.releaseFirstSave();
    await delayed.waitForSaves(EXPECTED_SAVE_TOTAL);

    restored = createSessionStore({ skipBrowser: true });
    const report = await reconcilePersistedSessions({ store: restored, persistedStore });

    expect(report).toEqual({ loaded: 1, expired: 0, skippedInvalid: 0 });
    expect(restored.listQuestions(started.session_id).questions).toEqual([
      {
        id: pushed.question_id,
        type: QUESTIONS.ASK_TEXT,
        status: STATUSES.PENDING,
        createdAt: expect.any(String),
        answeredAt: undefined,
      },
    ]);

    const session = restored.getSession(started.session_id);
    expect(session?.title).toBe(TITLE);
    expect(session?.ownerSessionID).toBe(OWNER_SESSION_ID);
    expect(session?.questions.get(pushed.question_id)?.config).toEqual({ question: QUESTION });
  });
});
