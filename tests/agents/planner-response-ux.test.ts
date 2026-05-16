import { describe, expect, it } from "bun:test";

import { plannerAgent } from "@/agents/planner";

const PROMPT = plannerAgent.prompt ?? "";

describe("planner response UX planning rules", () => {
  it("requires behavior commitment mapping and decision-minimal response tasks", () => {
    expect(PROMPT).toContain("行为承诺映射");
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("question tool");
  });

  it("marks high-risk workflow/lifecycle/prompt surfaces as reviewer mandatory", () => {
    expect(PROMPT).toContain("reviewer mandatory");
    expect(PROMPT).toContain("workflow/lifecycle");
    expect(PROMPT).toContain("agent prompts");
  });
});
