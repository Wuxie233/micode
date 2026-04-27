import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createPushQuestionTool, createQuestionToolFactory } from "@/tools/octto/factory";

const fakeContext = (sessionID: string) => ({ sessionID }) as never;
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];

describe("question tool factory ownership", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("push_question refuses for non-owner and does not push", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const { push_question } = createPushQuestionTool(store);

    const out = (await push_question.execute(
      { session_id: start.session_id, type: "ask_text", config: { question: "hijack?" } } as never,
      fakeContext("owner-B"),
    )) as string;

    expect(out).toContain("## Forbidden");
    const session = store.getSession(start.session_id);
    expect(session?.questions.size).toBe(1);
  });

  it("push_question returns existing not-found error for unknown session", async () => {
    const { push_question } = createPushQuestionTool(store);
    const out = (await push_question.execute(
      { session_id: "missing", type: "ask_text", config: { question: "x" } } as never,
      fakeContext("owner-A"),
    )) as string;

    expect(out).toContain("Failed");
    expect(out).not.toContain("## Forbidden");
  });

  it("typed factory tool refuses for non-owner", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const factory = createQuestionToolFactory(store);
    const askTextTool = factory<{ session_id: string; question: string }>({
      type: "ask_text",
      description: "ask text",
      args: {},
      toConfig: (args) => ({ question: args.question }),
    });

    const out = (await askTextTool.execute(
      { session_id: start.session_id, question: "from B" } as never,
      fakeContext("owner-B"),
    )) as string;

    expect(out).toContain("## Forbidden");
  });
});
