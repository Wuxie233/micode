import { describe, expect, it } from "bun:test";

import { reviewerAgent } from "@/agents/reviewer";

const PROMPT = reviewerAgent.prompt ?? "";

describe("reviewer conflict scope prompt", () => {
  it("requires conflict resolver scope validation", () => {
    expect(PROMPT).toContain("conflict resolver scope");
    expect(PROMPT).toContain("conflict files");
    expect(PROMPT).toContain("directly related tests/types/call sites");
  });

  it("escalates semantic ambiguity and raw-output leakage", () => {
    expect(PROMPT).toContain("semantic ambiguity");
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("raw recovery hint");
  });
});
