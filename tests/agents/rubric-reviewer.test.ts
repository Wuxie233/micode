import { describe, expect, it } from "bun:test";

import { rubricReviewerAgent } from "../../src/agents/rubric-reviewer";

describe("rubric-reviewer agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(rubricReviewerAgent.mode).toBe("subagent");
    expect(rubricReviewerAgent.tools?.write).toBe(false);
    expect(rubricReviewerAgent.tools?.edit).toBe(false);
    expect(rubricReviewerAgent.tools?.bash).toBe(false);
    expect(rubricReviewerAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-disciplined scoring", () => {
    expect(rubricReviewerAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only rubric reviewer specialist", () => {
    const description = (rubricReviewerAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("rubric");
  });

  it("declares the micode subagent environment", () => {
    const prompt = rubricReviewerAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (rubricReviewerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt declares the five category ratings", () => {
    const prompt = rubricReviewerAgent.prompt ?? "";
    expect(prompt).toContain("Excellent");
    expect(prompt).toContain("Good");
    expect(prompt).toContain("Acceptable");
    expect(prompt).toContain("Poor");
    expect(prompt).toContain("Failed");
  });

  it("prompt forbids a 1-10 aggregate score", () => {
    const lower = (rubricReviewerAgent.prompt ?? "").toLowerCase();
    expect(lower).toMatch(/no.*1.?10|do not.*aggregate|never.*total\s*score|forbid.*1.?10/);
  });

  it("prompt requires per-dimension scoring with mandatory evidence", () => {
    const lower = (rubricReviewerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("per dimension");
    expect(lower).toContain("evidence");
  });

  it("prompt allows CANNOT_ASSESS when evidence is missing", () => {
    const prompt = rubricReviewerAgent.prompt ?? "";
    expect(prompt).toContain("CANNOT_ASSESS");
  });

  it("prompt forbids overlap with reviewer, planner, executor, critic", () => {
    const lower = (rubricReviewerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the reviewer");
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the critic");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (rubricReviewerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });
});
