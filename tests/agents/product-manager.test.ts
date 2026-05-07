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
});
