import { describe, expect, it } from "bun:test";

import { executorDirectAgent } from "../../src/agents/executor-direct";

describe("executor-direct agent", () => {
  it("is a subagent with low temperature for scoped direct execution", () => {
    expect(executorDirectAgent.mode).toBe("subagent");
    expect(executorDirectAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("disables task tool so it cannot dispatch other subagents", () => {
    expect(executorDirectAgent.tools?.task).toBe(false);
  });

  it("keeps write, edit, and bash enabled for scoped direct work", () => {
    // tools default to true when undefined in AgentConfig; ensure they are not disabled
    expect(executorDirectAgent.tools?.write).not.toBe(false);
    expect(executorDirectAgent.tools?.edit).not.toBe(false);
    expect(executorDirectAgent.tools?.bash).not.toBe(false);
  });

  it("describes itself as a no-plan scoped direct executor", () => {
    const description = (executorDirectAgent.description ?? "").toLowerCase();
    expect(description).toContain("direct");
    expect(description).toContain("scoped");
  });

  it("prompt forbids spawning subagents, plans, lifecycle ownership, default commit/push, restart, and secret output", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("spawn_agent");
    expect(prompt).toContain("plan");
    expect(prompt).toContain("lifecycle");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("push");
    expect(prompt).toContain("restart");
    expect(prompt).toContain("secret");
  });

  it("prompt requires execution-envelope, self-review, verification, and escalation rules", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("execution envelope");
    expect(prompt).toContain("self-review");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("escalation");
  });

  it("prompt enumerates the four escalation targets: investigator, planner, executor, user-confirmation", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("investigator");
    expect(prompt).toContain("planner");
    expect(prompt).toContain("executor");
    expect(prompt).toContain("user confirmation");
  });

  it("prompt declares the micode environment, matching other subagents", () => {
    const prompt = executorDirectAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids becoming a dispatcher or generic runner", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("not a dispatcher");
    expect(prompt).toContain("not a runner");
  });
});
