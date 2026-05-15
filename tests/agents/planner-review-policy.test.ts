import { describe, expect, it } from "bun:test";

import { plannerAgent } from "@/agents/planner";

const PROMPT = plannerAgent.prompt ?? "";

describe("planner review policy prompt contract", () => {
  it("declares a review-policy mapping block", () => {
    expect(PROMPT).toContain("<review-policy-generation");
    expect(PROMPT).toContain("risk observation");
    expect(PROMPT).toContain("reviewer mandatory");
    expect(PROMPT).toContain("reviewer-skip eligible");
  });

  it("lists the low-risk whitelist and high-risk mandatory surfaces", () => {
    expect(PROMPT).toContain("low-risk whitelist");
    expect(PROMPT).toContain("agent prompts");
    expect(PROMPT).toContain("lifecycle/runtime/deploy");
    expect(PROMPT).toContain("contracts/API/schema/data migration");
    expect(PROMPT).toContain("secrets/safety/security/auth");
    expect(PROMPT).toContain("concurrency/retry/cache/error handling");
  });

  it("extends task-node format with Review policy", () => {
    expect(PROMPT).toContain("**Review policy:**");
    expect(PROMPT).toContain("mandatory | skip-eligible");
    expect(PROMPT).toContain("mandatory reason");
  });

  it("adds a plan-level review policy summary before dependency graph", () => {
    const reviewIndex = PROMPT.indexOf("## Review Policy");
    const graphIndex = PROMPT.indexOf("## Dependency Graph");

    expect(reviewIndex).toBeGreaterThan(0);
    expect(graphIndex).toBeGreaterThan(reviewIndex);
  });
});
