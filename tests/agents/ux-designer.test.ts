import { describe, expect, it } from "bun:test";

import { uxDesignerAgent } from "../../src/agents/ux-designer";

describe("ux-designer agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(uxDesignerAgent.mode).toBe("subagent");
    expect(uxDesignerAgent.tools?.write).toBe(false);
    expect(uxDesignerAgent.tools?.edit).toBe(false);
    expect(uxDesignerAgent.tools?.bash).toBe(false);
    expect(uxDesignerAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for disciplined UX critique", () => {
    expect(uxDesignerAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only UX designer specialist", () => {
    const description = (uxDesignerAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("ux");
  });

  it("declares the micode subagent environment", () => {
    const prompt = uxDesignerAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (uxDesignerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt anchors to WCAG 2.2, Material Design 3, Apple HIG, Core Web Vitals", () => {
    const prompt = uxDesignerAgent.prompt ?? "";
    expect(prompt).toContain("WCAG 2.2");
    expect(prompt).toContain("Material Design 3");
    expect(prompt).toContain("Apple HIG");
    expect(prompt).toContain("Core Web Vitals");
  });

  it("prompt anchors to Nielsen 10 heuristics plus AI Transparency / Explainability", () => {
    const prompt = uxDesignerAgent.prompt ?? "";
    expect(prompt).toContain("Nielsen");
    expect(prompt.toLowerCase()).toContain("transparency");
    expect(prompt.toLowerCase()).toContain("explainability");
  });

  it("prompt declares severity 0-4 with severity * frequency * business impact ranking", () => {
    const prompt = uxDesignerAgent.prompt ?? "";
    expect(prompt).toContain("0");
    expect(prompt).toContain("4");
    expect(prompt.toLowerCase()).toContain("severity");
    expect(prompt.toLowerCase()).toContain("frequency");
    expect(prompt.toLowerCase()).toContain("business impact");
  });

  it("prompt forbids overlap with planner, executor, critic", () => {
    const lower = (uxDesignerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the critic");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (uxDesignerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });
});
