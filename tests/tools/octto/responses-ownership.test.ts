import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createResponseTools } from "@/tools/octto/responses";

const fakeContext = (sessionID: string) => ({ sessionID }) as never;
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];
const ownerA = "owner-A";
const ownerB = "owner-B";

describe("response tools ownership", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("get_next_answer refuses non-owner for session", async () => {
    const start = await store.startSession({ ownerSessionID: ownerA, questions: askText });
    const { get_next_answer } = createResponseTools(store);
    const out = (await get_next_answer.execute(
      { session_id: start.session_id, block: false } as never,
      fakeContext(ownerB),
    )) as string;

    expect(out).toContain("## Forbidden");
  });

  it("get_answer refuses non-owner for the session owning the question", async () => {
    const start = await store.startSession({ ownerSessionID: ownerA, questions: askText });
    const session = store.getSession(start.session_id);
    const questionId = [...(session?.questions.keys() ?? [])][0] ?? "";
    const { get_answer } = createResponseTools(store);
    const out = (await get_answer.execute(
      { question_id: questionId, block: false } as never,
      fakeContext(ownerB),
    )) as string;

    expect(out).toContain("## Forbidden");
  });

  it("cancel_question refuses non-owner", async () => {
    const start = await store.startSession({ ownerSessionID: ownerA, questions: askText });
    const session = store.getSession(start.session_id);
    const questionId = [...(session?.questions.keys() ?? [])][0] ?? "";
    const { cancel_question } = createResponseTools(store);
    const out = (await cancel_question.execute({ question_id: questionId } as never, fakeContext(ownerB))) as string;

    expect(out).toContain("## Forbidden");
  });

  it("list_questions without session_id only lists sessions owned by caller", async () => {
    const a = await store.startSession({ ownerSessionID: ownerA, questions: askText });
    const b = await store.startSession({ ownerSessionID: ownerB, questions: askText });
    const { list_questions } = createResponseTools(store);
    const out = (await list_questions.execute({} as never, fakeContext(ownerA))) as string;
    const lines = out
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("ID") && !line.includes("----"));

    expect(lines.length).toBe(1);
    expect(out).toContain(a.question_ids?.[0] ?? "");
    expect(out).not.toContain(b.question_ids?.[0] ?? "");
  });
});
