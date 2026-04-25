// tests/tools/octto/session.test.ts
import { describe, expect, it } from "bun:test";

import type { SessionStore } from "../../../src/octto/session/sessions";
import type { StartSessionInput, StartSessionOutput } from "../../../src/octto/session/types";
import { createSessionTools } from "../../../src/tools/octto/session";

type Execute = (args: unknown, context: unknown) => Promise<string>;

const questionA = {
  type: "ask_text" as const,
  config: { question: "A?" },
};

const questionB = {
  type: "confirm" as const,
  config: { question: "B?" },
};

function createFakeStore() {
  let captured: StartSessionInput | undefined;
  const store = {
    startSession: async (input: StartSessionInput): Promise<StartSessionOutput> => {
      captured = input;
      const ids = input.questions?.map((_, index) => `q${index}`);
      return { session_id: "session-1", url: "http://octto.local", question_ids: ids };
    },
    endSession: async () => ({ ok: true }),
  } as unknown as SessionStore;
  return { store, captured: () => captured };
}

const runStartSession = async (args: unknown, store: SessionStore): Promise<string> => {
  const tools = createSessionTools(store);
  const execute = tools.start_session.execute as unknown as Execute;
  return execute(args, { sessionID: "parent" });
};

describe("start_session array-like questions", () => {
  it("normalizes indexed object questions before starting the session", async () => {
    const fake = createFakeStore();
    const output = await runStartSession({ questions: { "1": questionB, "0": questionA } }, fake.store);

    expect(output).toContain("Session Started");
    expect(fake.captured()?.questions).toEqual([questionA, questionB]);
  });

  it("normalizes a single question object", async () => {
    const fake = createFakeStore();
    await runStartSession({ questions: questionA }, fake.store);

    expect(fake.captured()?.questions).toEqual([questionA]);
  });
});
