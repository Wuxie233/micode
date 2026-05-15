import { describe, expect, it } from "bun:test";

import { QUESTION_FIRST_DECISION_PROTOCOL } from "@/agents/question-first-decision";

describe("question-first decision protocol", () => {
  it("makes built-in question the default for real user decisions", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toMatch(/built-in `question` tool|内置 `question` tool/);
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("default");
  });

  it("keeps plain chat limited to ultra-light notification and fallback", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("plain chat");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("ultra-light");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("fallback");
  });

  it("defines conflict decision options with a recommended default and safe pause", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("preserve both semantics");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("user-supplied business choice");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("pause and preserve temp worktree");
  });
});
