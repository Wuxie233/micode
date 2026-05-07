import { describe, expect, it } from "bun:test";

import { DEFAULT_MODEL } from "../../src/utils/config";

const FORBIDDEN_DIRECT_AGENT_NAMES = ["runner", "operator", "light-executor"] as const;

const SPECIALIST_AGENT_NAMES = [
  "product-manager",
  "software-architect",
  "ux-designer",
  "architecture-quality-inspector",
  "rubric-reviewer",
] as const;

describe("agents index", () => {
  it("should not export handoff agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["handoff-creator"]).toBeUndefined();
    expect(module.agents["handoff-resumer"]).toBeUndefined();
    expect((module as Record<string, unknown>).handoffCreatorAgent).toBeUndefined();
    expect((module as Record<string, unknown>).handoffResumerAgent).toBeUndefined();
  });

  it("should still export other agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["ledger-creator"]).toBeDefined();
    expect(module.agents.brainstormer).toBeDefined();
    expect(module.agents.commander).toBeDefined();
  });

  it("registers investigator agent at default model", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.investigator).toBeDefined();
    expect(module.agents.investigator.mode).toBe("subagent");
    expect(module.agents.investigator.model).toBe(DEFAULT_MODEL);
  });

  it("re-exports investigatorAgent from the agents barrel", async () => {
    const module = await import("../../src/agents/index");

    expect(module.investigatorAgent).toBeDefined();
  });

  it("registers critic agent at default model", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.critic).toBeDefined();
    expect(module.agents.critic.mode).toBe("subagent");
    expect(module.agents.critic.model).toBe(DEFAULT_MODEL);
  });

  it("registers critic with read-only tool restrictions", async () => {
    const module = await import("../../src/agents/index");
    const agent = module.agents.critic;

    expect(agent.tools?.write).toBe(false);
    expect(agent.tools?.edit).toBe(false);
    expect(agent.tools?.bash).toBe(false);
    expect(agent.tools?.task).toBe(false);
  });

  it("re-exports criticAgent from the agents barrel", async () => {
    const module = await import("../../src/agents/index");

    expect((module as Record<string, unknown>).criticAgent).toBeDefined();
  });

  it("registers executor-direct with a non-empty model", async () => {
    const module = await import("../../src/agents/index");
    const agent = module.agents["executor-direct"];

    expect(agent).toBeDefined();
    expect(typeof agent.model).toBe("string");
    expect(agent.model.length).toBeGreaterThan(0);
  });

  it("re-exports executorDirectAgent as a subagent", async () => {
    const module = await import("../../src/agents/index");

    expect(module.executorDirectAgent).toBeDefined();
    expect(module.executorDirectAgent.mode).toBe("subagent");
  });

  it("keeps executor registered alongside executor-direct", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.executor).toBeDefined();
    expect(module.agents.executor.mode).toBe("subagent");
    expect(module.agents["executor-direct"]).toBeDefined();
  });

  it("does not register runner-style direct execution agents", async () => {
    const module = await import("../../src/agents/index");

    for (const name of FORBIDDEN_DIRECT_AGENT_NAMES) {
      expect(module.agents[name]).toBeUndefined();
    }
  });

  it("should register mindmodel v2 analysis agents", async () => {
    const module = await import("../../src/agents/index");

    // New v2 analysis agents
    expect(module.agents["mm-dependency-mapper"]).toBeDefined();
    expect(module.agents["mm-convention-extractor"]).toBeDefined();
    expect(module.agents["mm-domain-extractor"]).toBeDefined();
    expect(module.agents["mm-code-clusterer"]).toBeDefined();
    expect(module.agents["mm-anti-pattern-detector"]).toBeDefined();
    expect(module.agents["mm-constraint-writer"]).toBeDefined();
    expect(module.agents["mm-constraint-reviewer"]).toBeDefined();
  });

  it("should configure mindmodel v2 agents as subagents", async () => {
    const module = await import("../../src/agents/index");

    const v2Agents = [
      "mm-dependency-mapper",
      "mm-convention-extractor",
      "mm-domain-extractor",
      "mm-code-clusterer",
      "mm-anti-pattern-detector",
      "mm-constraint-writer",
      "mm-constraint-reviewer",
    ];

    for (const agentName of v2Agents) {
      const agent = module.agents[agentName];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("registers all five specialist agents at default model", async () => {
    const module = await import("../../src/agents/index");

    for (const name of SPECIALIST_AGENT_NAMES) {
      const agent = module.agents[name];
      expect(agent).toBeDefined();
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("registers all five specialists with read-only tool restrictions", async () => {
    const module = await import("../../src/agents/index");

    for (const name of SPECIALIST_AGENT_NAMES) {
      const agent = module.agents[name];
      expect(agent.tools?.write).toBe(false);
      expect(agent.tools?.edit).toBe(false);
      expect(agent.tools?.bash).toBe(false);
      expect(agent.tools?.task).toBe(false);
    }
  });

  it("re-exports all five specialist agent objects from the barrel", async () => {
    const module = (await import("../../src/agents/index")) as Record<string, unknown>;

    expect(module.productManagerAgent).toBeDefined();
    expect(module.softwareArchitectAgent).toBeDefined();
    expect(module.uxDesignerAgent).toBeDefined();
    expect(module.architectureQualityInspectorAgent).toBeDefined();
    expect(module.rubricReviewerAgent).toBeDefined();
  });

  it("should use DEFAULT_MODEL for all agents", async () => {
    const module = await import("../../src/agents/index");

    for (const [_name, agent] of Object.entries(module.agents)) {
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });
});
