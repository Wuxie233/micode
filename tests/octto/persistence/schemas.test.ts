import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { PersistedSessionSchema, parsePersistedSession } from "@/octto/persistence/schemas";

const CREATED_AT = 1_776_000_000_000;
const ANSWERED_AT = CREATED_AT + 1_000;
const UPDATED_AT = ANSWERED_AT + 1_000;

const QUESTION = {
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
} as const;

const SESSION = {
  session_id: "session-1",
  title: "Octto session",
  url: "https://octto.example/s/session-1",
  owner_session_id: "owner-1",
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  questions: [QUESTION],
  auto_resume_owner_session_id: null,
} as const;

describe("octto persisted session schemas", () => {
  it("round trips a contract-shaped persisted session", () => {
    const parsed = parsePersistedSession(SESSION);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected persisted session to parse");
    }
    expect(parsed.session).toEqual(SESSION);
  });

  it("rejects a persisted session missing a required field", () => {
    const { owner_session_id: _ownerSessionId, ...missingOwner } = SESSION;
    const parsed = parsePersistedSession(missingOwner);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected persisted session to be rejected");
    }
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("ignores additional fields using Valibot object behavior", () => {
    const parsed = v.parse(PersistedSessionSchema, {
      ...SESSION,
      ignored: true,
      questions: [
        {
          ...QUESTION,
          ignored: true,
        },
      ],
    });

    expect("ignored" in parsed).toBe(false);
    expect("ignored" in parsed.questions[0]).toBe(false);
    expect(parsed.questions[0].config).toEqual(QUESTION.config);
    expect(parsed.questions[0].response).toEqual(QUESTION.response);
  });
});
