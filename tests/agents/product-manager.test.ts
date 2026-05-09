import { describe, expect, it } from "bun:test";

import { productManagerAgent } from "../../src/agents/product-manager";

describe("product-manager agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(productManagerAgent.mode).toBe("subagent");
    expect(productManagerAgent.tools?.write).toBe(false);
    expect(productManagerAgent.tools?.edit).toBe(false);
    expect(productManagerAgent.tools?.bash).toBe(false);
    expect(productManagerAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for disciplined PRD output", () => {
    expect(productManagerAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only product manager specialist", () => {
    const description = (productManagerAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("product");
  });

  it("declares the micode subagent environment", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt caps clarifying questions at 3 and requires recommended defaults", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toMatch(/\b3\b/);
    expect(prompt.toLowerCase()).toContain("default");
  });

  it("prompt declares A/B/C/D/E option discipline with D=custom and E=auto", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("A");
    expect(prompt).toContain("B");
    expect(prompt).toContain("C");
    expect(prompt).toContain("D");
    expect(prompt).toContain("E");
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/d[^a-z0-9]{0,8}(custom|自定义)/);
    expect(lower).toMatch(/e[^a-z0-9]{0,8}(auto|自动)/);
  });

  it("prompt requires PRD output with user stories, Given/When/Then, and Non-Goals", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("PRD");
    expect(prompt.toLowerCase()).toContain("user stor");
    expect(prompt).toContain("Given");
    expect(prompt).toContain("When");
    expect(prompt).toContain("Then");
    expect(prompt).toContain("Non-Goals");
  });

  it("prompt forbids overlap with planner, executor, brainstormer", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the brainstormer");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });

  // ---- Upgrade assertions (issue #57) ----

  it("prompt anchors product-manager as a professional PM, not a template", () => {
    const prompt = productManagerAgent.prompt ?? "";
    const lower = prompt.toLowerCase();
    expect(lower).toContain("professional");
    expect(lower).toContain("product manager");
    // The 6 PM judgment dimensions called out in <purpose> / <pm-judgment>
    expect(lower).toContain("problem framing");
    expect(lower).toContain("stakeholder");
    expect(lower).toContain("success");
    expect(lower).toContain("scope");
    expect(lower).toContain("risk");
    expect(lower).toContain("recommendation");
  });

  it("prompt PRD requires Problem/Opportunity, Stakeholders, Success Metrics sections", () => {
    const prompt = productManagerAgent.prompt ?? "";
    // Problem/Opportunity heading
    expect(prompt).toMatch(/Problem\s*\/?\s*Opportunity|Problem & Opportunity/);
    // Stakeholders heading (case-sensitive PRD section header)
    expect(prompt).toContain("Stakeholders");
    // Success Metrics heading
    expect(prompt).toMatch(/Success Metric/);
  });

  it("prompt PRD requires explicit Scope Boundary with In Scope / Out of Scope", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Scope Boundary");
    expect(prompt).toContain("In Scope");
    expect(prompt).toContain("Out of Scope");
  });

  it("prompt PRD requires Risks & Assumptions section", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Risks");
    expect(prompt).toContain("Assumptions");
  });

  it("prompt PRD requires mandatory Decision Recommendation with three outcomes", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Decision Recommendation");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("build as proposed");
    expect(lower).toContain("build with adjustments");
    // "do not build" or "defer" — accept either since design lists both
    expect(lower).toMatch(/do not build|defer/);
  });

  it("prompt has evidence discipline: cite source or mark Cannot Assess", () => {
    const prompt = productManagerAgent.prompt ?? "";
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/evidence|证据/);
    expect(prompt).toContain("Cannot Assess");
  });

  it("prompt forbids omitting Decision Recommendation in never-do block", () => {
    const prompt = productManagerAgent.prompt ?? "";
    // The never-do block must explicitly forbid omitting Decision Recommendation.
    // Match within ~120 chars after a NEVER keyword to ensure the forbid is bound to "Decision Recommendation".
    expect(prompt).toMatch(/NEVER[^\n]{0,120}Decision Recommendation/);
  });
});
