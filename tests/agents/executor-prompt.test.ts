import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

const REVIEW_CHANGES_REQUESTED = "review_changes_requested";
const PROMPT_WINDOW_LENGTH = 400;

function outcomeGuidance(): string {
  const index = executorAgent.prompt.indexOf(REVIEW_CHANGES_REQUESTED);
  expect(index).toBeGreaterThanOrEqual(0);

  return executorAgent.prompt.slice(index, index + PROMPT_WINDOW_LENGTH);
}

describe("executor agent prompt contract for review_changes_requested", () => {
  it("references the review_changes_requested outcome literal", () => {
    expect(executorAgent.prompt).toContain(REVIEW_CHANGES_REQUESTED);
  });

  it("documents that review_changes_requested triggers a fix cycle", () => {
    const guidance = outcomeGuidance();
    const mentionsFixCycle = /fix\s+cycle|fix\s+implementer|re-?review|spawn.*fix/i.test(guidance);

    expect(mentionsFixCycle).toBe(true);
  });

  it("explicitly tells the executor not to resume_subagent on review_changes_requested", () => {
    expect(outcomeGuidance().toLowerCase()).toMatch(/not.*resume|never.*resume|do not call resume/);
  });

  it("still documents resume_subagent for task_error and blocked", () => {
    expect(executorAgent.prompt).toContain("task_error");
    expect(executorAgent.prompt).toContain("blocked");
    expect(executorAgent.prompt).toContain("resume_subagent");
  });
});
