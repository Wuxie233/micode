import { describe, expect, it } from "bun:test";
import type { AgentConfig } from "@opencode-ai/sdk";

import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";

const SPAWN_AGENT_TOOL = "spawn_agent";

function getSpawnAgentOverride(agent: AgentConfig): unknown {
  return agent.tools?.[SPAWN_AGENT_TOOL];
}

function hasSpawnAgentOverride(agent: AgentConfig): boolean {
  return Object.hasOwn(agent.tools ?? {}, SPAWN_AGENT_TOOL);
}

describe("brainstormer agent", () => {
  it("has a non-empty prompt", () => {
    expect(brainstormerAgent.prompt).toBeString();
    expect(brainstormerAgent.prompt?.trim().length).toBeGreaterThan(0);
  });

  it("contains lifecycle guidance", () => {
    expect(brainstormerAgent.prompt).toContain("<lifecycle>");
    expect(brainstormerAgent.prompt).toContain("lifecycle_start_request");
  });

  it("brainstormer enables spawn_agent for model override escape hatch", () => {
    expect(getSpawnAgentOverride(brainstormerAgent)).not.toBe(false);
  });

  it("brainstormer prompt documents the escape hatch with sunset clause", () => {
    const prompt = brainstormerAgent.prompt ?? "";

    expect(prompt).toContain("model");
    expect(prompt).toContain("Task");
    expect(prompt).toContain("废除");
    expect(prompt).toContain("反例");
  });

  it("commander keeps spawn_agent disabled for lifecycle integrity", () => {
    expect(getSpawnAgentOverride(commanderAgent)).toBe(false);
  });

  it("octto keeps spawn_agent in its upstream default state (no explicit override)", () => {
    expect(hasSpawnAgentOverride(octtoAgent)).toBe(false);
  });

  it("primary agent spawn_agent configuration matches the documented contract", () => {
    expect(hasSpawnAgentOverride(brainstormerAgent)).toBe(false);
    expect(getSpawnAgentOverride(commanderAgent)).toBe(false);
    expect(hasSpawnAgentOverride(octtoAgent)).toBe(false);
  });
});
