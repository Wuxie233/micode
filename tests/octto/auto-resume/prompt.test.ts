import { describe, expect, it } from "bun:test";

import { buildContinuePrompt } from "../../../src/octto/auto-resume/prompt";

const expectedSingularPrompt =
  '你之前的会话有用户回答到达 (question_id=question-1)。请调用 `get_next_answer({session_id: "conversation-1"})` 取出答案,然后继续原任务。';

const expectedMultiPrompt =
  '你之前的会话有 3 个用户回答到达 (question_ids=question-1, question-2, question-3)。请反复调用 `get_next_answer({session_id: "conversation-1"})` 取出全部答案,然后继续原任务。';

describe("auto-resume continue prompt", () => {
  it("builds the exact singular prompt", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionIds: ["question-1"] });

    expect(prompt).toBe(expectedSingularPrompt);
  });

  it("builds the exact multi-answer prompt", () => {
    const prompt = buildContinuePrompt({
      conversationId: "conversation-1",
      questionIds: ["question-1", "question-2", "question-3"],
    });

    expect(prompt).toBe(expectedMultiPrompt);
  });

  it("removes template placeholders", () => {
    const prompt = buildContinuePrompt({
      conversationId: "conversation-1",
      questionIds: ["question-1", "question-2", "question-3"],
    });

    expect(prompt).not.toContain("{conversationId}");
    expect(prompt).not.toContain("{questionId}");
    expect(prompt).not.toContain("{questionIds}");
    expect(prompt).not.toContain("{count}");
  });

  it("does not throw for empty id and list", () => {
    expect(() => buildContinuePrompt({ conversationId: "", questionIds: [] })).not.toThrow();
  });

  it("falls back to singular template for an empty list and includes get_next_answer for conversation", () => {
    const prompt = buildContinuePrompt({ conversationId: "conversation-1", questionIds: [] });

    expect(prompt).toBe(
      '你之前的会话有用户回答到达 (question_id=)。请调用 `get_next_answer({session_id: "conversation-1"})` 取出答案,然后继续原任务。',
    );
    expect(prompt).toContain('get_next_answer({session_id: "conversation-1"})');
  });
});
