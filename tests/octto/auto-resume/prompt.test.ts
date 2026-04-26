import { describe, expect, it } from "bun:test";

import { buildContinuePrompt } from "../../../src/octto/auto-resume/prompt";

const expectedPrompt =
  '你之前的会话有用户回答到达 (question_id=question-1)。请调用 `get_next_answer({session_id: "conversation-1"})` 取出答案,然后继续原任务。';

describe("auto-resume continue prompt", () => {
  it("substitutes the conversation and question ids", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionId: "question-1" });

    expect(prompt).toBe(expectedPrompt);
  });

  it("removes template placeholders", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionId: "question-1" });

    expect(prompt).not.toContain("{conversationId}");
    expect(prompt).not.toContain("{questionId}");
  });

  it("does not throw for empty ids", () => {
    expect(() => buildContinuePrompt({ conversationId: "", questionId: "" })).not.toThrow();
  });
});
