import { describe, expect, it } from "bun:test";

import { architectureQualityInspectorAgent } from "../../src/agents/architecture-quality-inspector";

describe("architecture-quality-inspector agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(architectureQualityInspectorAgent.mode).toBe("subagent");
    expect(architectureQualityInspectorAgent.tools?.write).toBe(false);
    expect(architectureQualityInspectorAgent.tools?.edit).toBe(false);
    expect(architectureQualityInspectorAgent.tools?.bash).toBe(false);
    expect(architectureQualityInspectorAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-disciplined inspection", () => {
    expect(architectureQualityInspectorAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only architecture quality inspector", () => {
    const description = (architectureQualityInspectorAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("architecture");
    expect(description).toContain("quality");
  });

  it("declares the micode subagent environment", () => {
    const prompt = architectureQualityInspectorAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (architectureQualityInspectorAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt anchors to SOLID, circular dependencies, anti-patterns, coupling constraints", () => {
    const prompt = architectureQualityInspectorAgent.prompt ?? "";
    expect(prompt).toContain("SOLID");
    expect(prompt.toLowerCase()).toContain("circular");
    expect(prompt.toLowerCase()).toContain("anti-pattern");
    expect(prompt.toLowerCase()).toContain("coupling");
  });

  it("prompt declares P0/P1/P2/P3 finding tiers", () => {
    const prompt = architectureQualityInspectorAgent.prompt ?? "";
    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
  });

  it("prompt declares the three terminal verdicts", () => {
    const prompt = architectureQualityInspectorAgent.prompt ?? "";
    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("APPROVED with required fixes");
    expect(prompt).toContain("CHANGES REQUESTED");
  });

  it("prompt forbids overlap with reviewer (executor loop)", () => {
    const lower = (architectureQualityInspectorAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the reviewer");
  });

  it("prompt forbids overlap with planner, executor, critic", () => {
    const lower = (architectureQualityInspectorAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the critic");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (architectureQualityInspectorAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });
});
