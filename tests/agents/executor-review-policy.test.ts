import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

const REQUIRED_REVIEW_POLICY_STRINGS = [
  "implementer cannot skip reviewer",
  "executor verifies",
  "review skipped: low-risk whitelist",
  "low-risk whitelist",
  "mandatory triggers",
  "risk observation",
  "missing review policy",
  "uncertain defaults to reviewer",
  "default full reviewer",
  "reviewer coverage",
  "skipped low-risk tasks",
  "batch summary",
];

describe("executor review policy execution prompt contract", () => {
  it("declares the review-policy-execution block", () => {
    expect(executorAgent.prompt).toContain("<review-policy-execution");
    expect(executorAgent.prompt).toContain("</review-policy-execution>");
  });

  it("contains the review policy decision and reporting vocabulary", () => {
    for (const required of REQUIRED_REVIEW_POLICY_STRINGS) {
      expect(executorAgent.prompt).toContain(required);
    }
  });

  it("propagates review policy through the context-brief", () => {
    const prompt = executorAgent.prompt;
    const contextBriefIndex = prompt.indexOf("<context-brief");
    expect(contextBriefIndex).toBeGreaterThanOrEqual(0);

    const contextBrief = prompt.slice(contextBriefIndex, prompt.indexOf("</context-brief>", contextBriefIndex));
    expect(contextBrief).toContain("Review policy");
    expect(contextBrief).toContain("missing review policy");
    expect(contextBrief).toContain("uncertain defaults to reviewer");
  });

  it("keeps reviewer mandatory by default and only permits explicit low-risk skips", () => {
    const prompt = executorAgent.prompt;
    const blockStart = prompt.indexOf("<review-policy-execution");
    expect(blockStart).toBeGreaterThanOrEqual(0);
    const block = prompt.slice(blockStart, prompt.indexOf("</review-policy-execution>", blockStart));

    expect(block).toContain("default full reviewer");
    expect(block).toContain("mandatory triggers");
    expect(block).toContain("review skipped: low-risk whitelist");
    expect(block).toContain("implementer cannot skip reviewer");
  });

  it("keeps never-do reviewer guidance aligned with low-risk whitelist skip policy", () => {
    const prompt = executorAgent.prompt;

    expect(prompt).not.toContain("NEVER verify implementations yourself - ALWAYS spawn reviewer agents");
    expect(prompt).not.toContain("Never skip reviewer for any task");
    expect(prompt).toContain(
      'NEVER verify implementation correctness yourself; for reviewable tasks, ALWAYS spawn reviewer agents. Only skip when <review-policy-execution> permits executor-verified "review skipped: low-risk whitelist".',
    );
    expect(prompt).toContain(
      'Never skip reviewer except when executor verifies a plan-declared low-risk whitelist entry and records exact reason "review skipped: low-risk whitelist".',
    );
  });
});
