import { describe, expect, it } from "bun:test";

import { reviewerAgent } from "@/agents/reviewer";

const PROMPT = reviewerAgent.prompt ?? "";
const REVIEW_POLICY_AWARENESS = PROMPT.match(/<review-policy-awareness[\s\S]*?<\/review-policy-awareness>/)?.[0] ?? "";

const reviewPolicyRules = [...REVIEW_POLICY_AWARENESS.matchAll(/<rule>([\s\S]*?)<\/rule>/g)].map(([, rule]) => rule);

describe("reviewer review-policy awareness", () => {
  it("requires reading task review policy from the context brief or plan", () => {
    expect(PROMPT).toContain("review policy");
    expect(PROMPT).toContain("context-brief");
    expect(PROMPT).toContain("mandatory reviewer");
  });

  it("lists high-risk mandatory review surfaces", () => {
    expect(PROMPT).toContain("src/agents/**");
    expect(PROMPT).toContain("lifecycle/runtime/deploy/recovery");
    expect(PROMPT).toContain("planner/executor/reviewer contract");
    expect(PROMPT).toContain("Behavior / Commitments");
    expect(PROMPT).toContain("secrets/safety/security/auth");
    expect(PROMPT).toContain("concurrency/retry/cache/error handling");
  });

  it("maps missing mandatory policy specifically to CHANGES REQUESTED", () => {
    expect(
      reviewPolicyRules.some(
        (rule) => rule.includes("missing review policy") && rule.includes("emit CHANGES REQUESTED"),
      ),
    ).toBe(true);
  });
});
