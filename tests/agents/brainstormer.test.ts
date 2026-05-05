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

function readBrainstormerSource(): string {
  return require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
    "utf-8",
  );
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

  it("references investigator as a subagent for diagnostic read-only work", () => {
    const source = readBrainstormerSource();

    expect(source).toContain('name="investigator"');
    expect(source.toLowerCase()).toContain("diagnostic");
    expect(source.toLowerCase()).toContain("read-only");
  });

  it("documents the same four-class routing rule as the commander", () => {
    const source = readBrainstormerSource();

    expect(source).toContain("routing-by-requested-output");
    expect(source.toLowerCase()).toContain("location");
    expect(source.toLowerCase()).toContain("explanation");
    expect(source.toLowerCase()).toContain("diagnosis");
    expect(source.toLowerCase()).toContain("mutation");
  });

  it("does not introduce keyword trigger lists", () => {
    const source = readBrainstormerSource();

    expect(source).not.toMatch(/trigger\s+keywords?\s*:/i);
  });
});

describe("brainstormer routing: direct-execution output class", () => {
  it("declares an output-class for direct-execution mapped to executor-direct", () => {
    const match = readBrainstormerSource().match(/<output-class name="direct-execution" agent="([^"]+)">/);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("executor-direct");
  });

  it("describes direct-execution as the no-plan bounded scoped lane", () => {
    const match = readBrainstormerSource().match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );

    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("no plan");
    expect(body).toMatch(/bounded|scoped/);
  });

  it("registers executor-direct in the available-subagents block", () => {
    expect(readBrainstormerSource()).toMatch(/<subagent\s+name="executor-direct">/);
  });

  it("clarifies that mutation class still requires planner-then-executor for non-trivial work", () => {
    const match = readBrainstormerSource().match(
      /<output-class name="mutation" agent="executor">([\s\S]*?)<\/output-class>/,
    );

    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("planner");
    expect(body).toContain("executor");
  });
});

describe("brainstormer non-trivial detector guardrails", () => {
  it("declares a high-priority non-trivial detector block before the routing block", () => {
    const source = readBrainstormerSource();
    const detectorIdx = source.indexOf("<non-trivial-detector");
    const routingIdx = source.indexOf("<routing-by-requested-output");

    expect(detectorIdx).toBeGreaterThan(-1);
    expect(routingIdx).toBeGreaterThan(-1);
    expect(detectorIdx).toBeLessThan(routingIdx);
  });

  it("non-trivial-detector marks priority as HIGHEST", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector\s+priority="([^"]+)"/);

    expect(match?.[1]).toBe("HIGHEST");
  });

  it("forbids executor-direct for agent prompt and slash command surfaces", () => {
    const source = readBrainstormerSource().toLowerCase();

    // The detector or the direct-execution forbidden-for list must mention these surfaces.
    expect(source).toContain("agent");
    expect(source).toMatch(/slash[-\s]?command/);
  });

  it("forbids executor-direct for runtime, deploy, and workflow/lifecycle surfaces", () => {
    const source = readBrainstormerSource().toLowerCase();

    expect(source).toMatch(/runtime[-\s]sensitive|runtime\s+behavior|runtime\s+deploy/);
    expect(source).toMatch(/deploy/);
    expect(source).toMatch(/workflow|lifecycle/);
  });

  it("forbids executor-direct for cross-module feature work", () => {
    const source = readBrainstormerSource().toLowerCase();

    expect(source).toMatch(/cross[-\s]?module/);
  });

  it("direct-execution output-class declares a forbidden-for sub-list", () => {
    const source = readBrainstormerSource();
    const match = source.match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );

    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toContain("<forbidden-for");
  });

  it("preserves quick-mode legitimacy for trivial single-file or local-op tasks", () => {
    const source = readBrainstormerSource().toLowerCase();

    // The design constraint: trivial work must still have a path through direct execution.
    // We assert the prompt still mentions trivial / single-file / local-op as legitimate inputs.
    expect(source).toMatch(/trivial|single[-\s]file|local\s+op|typo/);
  });

  it("non-trivial-detector explicitly routes forbidden cases through lifecycle plus planner plus executor", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/);

    expect(match).not.toBeNull();
    const body = (match?.[0] ?? "").toLowerCase();
    expect(body).toContain("lifecycle");
    expect(body).toContain("planner");
    expect(body).toContain("executor");
  });

  it("non-trivial-detector forbids silent downgrade to executor-direct", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/);

    expect(match).not.toBeNull();
    const body = (match?.[0] ?? "").toLowerCase();
    // Must reference executor-direct AND a denial verb (forbidden / never / must not / do not).
    expect(body).toContain("executor-direct");
    expect(body).toMatch(/forbidden|never|must not|do not|cannot/);
  });
});
