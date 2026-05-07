// tests/agents/software-architect.test.ts
import { describe, expect, it } from "bun:test";

import { softwareArchitectAgent } from "../../src/agents/software-architect";

describe("software-architect agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(softwareArchitectAgent.mode).toBe("subagent");
    expect(softwareArchitectAgent.tools?.write).toBe(false);
    expect(softwareArchitectAgent.tools?.edit).toBe(false);
    expect(softwareArchitectAgent.tools?.bash).toBe(false);
    expect(softwareArchitectAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-disciplined architecture", () => {
    expect(softwareArchitectAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only software architect specialist", () => {
    const description = (softwareArchitectAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("architect");
  });

  it("declares the micode subagent environment", () => {
    const prompt = softwareArchitectAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (softwareArchitectAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt forces 2-3 alternatives with explicit trade-offs", () => {
    const prompt = softwareArchitectAgent.prompt ?? "";
    expect(prompt).toMatch(/2[\s-]?3|two\s+to\s+three/i);
    expect(prompt.toLowerCase()).toContain("alternative");
    expect(prompt.toLowerCase()).toContain("trade-off");
  });

  it("prompt anchors coupling analysis to mindmodel_lookup / atlas_lookup", () => {
    const prompt = softwareArchitectAgent.prompt ?? "";
    expect(prompt).toContain("mindmodel_lookup");
    expect(prompt.toLowerCase()).toContain("atlas");
    expect(prompt.toLowerCase()).toContain("coupling");
  });

  it("prompt requires a Recommended Option block with rationale", () => {
    const prompt = softwareArchitectAgent.prompt ?? "";
    expect(prompt).toContain("Recommended");
    expect(prompt.toLowerCase()).toContain("rationale");
  });

  it("prompt forbids overlap with planner, executor, brainstormer, critic", () => {
    const lower = (softwareArchitectAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the brainstormer");
    expect(lower).toContain("not the critic");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (softwareArchitectAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });
});
