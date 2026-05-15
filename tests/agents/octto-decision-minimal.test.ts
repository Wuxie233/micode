import { describe, expect, it } from "bun:test";

import { octtoAgent } from "@/agents/octto";

const PROMPT = octtoAgent.prompt ?? "";

describe("octto decision-minimal response UX", () => {
  it("injects decision-minimal and question-first protocols", () => {
    expect(PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
  });

  it("keeps octto effect-first block semantically aligned but workflow-specific", () => {
    expect(PROMPT).toContain("预期表现");
    expect(PROMPT).toContain("你可以怎么验收");
    expect(PROMPT).toMatch(/brainstorm|end_brainstorm|session/i);
  });
});
