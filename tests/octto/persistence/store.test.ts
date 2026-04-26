import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PersistedSession } from "@/octto/persistence/schemas";
import { createPersistedSessionStore } from "@/octto/persistence/store";

const PREFIX = "micode-octto-store-";
const CREATED_AT = 1_776_000_000_000;
const ANSWERED_AT = CREATED_AT + 1_000;
const UPDATED_AT = ANSWERED_AT + 1_000;
const MALFORMED_JSON = "{";

const createSession = (sessionId = "session-1"): PersistedSession => ({
  session_id: sessionId,
  title: "Octto session",
  url: `https://octto.example/s/${sessionId}`,
  owner_session_id: "owner-1",
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  questions: [
    {
      id: "question-1",
      type: "ask_text",
      status: "answered",
      created_at: CREATED_AT,
      answered_at: ANSWERED_AT,
      config: {
        question: "What should happen next?",
        multiline: true,
      },
      response: {
        text: "Continue the task.",
      },
    },
  ],
  auto_resume_owner_session_id: null,
});

describe("octto persisted session store", () => {
  let baseDir: string;
  let warning: ReturnType<typeof spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    warning = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warning.mockRestore();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("round trips a persisted session", async () => {
    const store = createPersistedSessionStore({ baseDir });
    const session = createSession();

    await store.save(session);

    await expect(store.load(session.session_id)).resolves.toEqual(session);
  });

  it("returns null for missing sessions", async () => {
    const store = createPersistedSessionStore({ baseDir });

    await expect(store.load("missing-session")).resolves.toBeNull();
  });

  it("returns null and warns for malformed JSON", async () => {
    const store = createPersistedSessionStore({ baseDir });
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "broken.json"), MALFORMED_JSON);

    await expect(store.load("broken")).resolves.toBeNull();
    expect(warning).toHaveBeenCalled();
  });

  it("lists persisted session ids without JSON suffixes", async () => {
    const store = createPersistedSessionStore({ baseDir });

    await store.save(createSession("session-a"));
    await store.save(createSession("session-b"));
    writeFileSync(join(baseDir, "ignored.txt"), "ignored");

    await expect(store.list()).resolves.toEqual(["session-a", "session-b"]);
  });

  it("deletes persisted sessions", async () => {
    const store = createPersistedSessionStore({ baseDir });
    const session = createSession();

    await store.save(session);
    await store.delete(session.session_id);

    await expect(store.load(session.session_id)).resolves.toBeNull();
  });
});
