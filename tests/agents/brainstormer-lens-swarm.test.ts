import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brainstormerAgent } from "@/agents/brainstormer";
import { LENS_SWARM_PROTOCOL } from "@/agents/lens-swarm-protocol";

const SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const PROMPT = brainstormerAgent.prompt ?? "";

describe("brainstormer Lens Swarm prompt contract", () => {
  it("imports and injects the shared Lens Swarm protocol", () => {
    expect(SOURCE).toContain("LENS_SWARM_PROTOCOL");
    expect(PROMPT).toContain(LENS_SWARM_PROTOCOL);
  });

  it("declares brainstorm-scout as an available read-only subagent", () => {
    expect(SOURCE).toContain('<subagent name="brainstorm-scout">');
    expect(SOURCE.toLowerCase()).toMatch(/brainstorm-scout[\s\S]{0,500}read-only/);
  });

  it("adds Discovery Swarm before planner trigger rules", () => {
    expect(PROMPT).toContain("Discovery Swarm");
    expect(PROMPT).toContain("before planner");
    expect(PROMPT).toContain("agent prompts");
    expect(PROMPT).toContain("planner / executor / reviewer");
    expect(PROMPT).toContain("workflow-sensitive");
  });

  it("requires design synthesis of adopted scout findings", () => {
    expect(PROMPT).toContain("Constraints / Approach / Components / Testing Strategy / Open Questions");
    expect(PROMPT).toContain("采纳");
    expect(PROMPT).toContain("不采纳");
  });

  it("routes generalized adversarial requests to swarm but preserves explicit critic roles", () => {
    expect(PROMPT).toContain("Adversarial Swarm");
    expect(PROMPT).toContain("泛化对抗审查");
    expect(PROMPT).toContain("explicit critic-role compatibility");
    expect(PROMPT).toContain("redteam");
    expect(PROMPT).toContain("yagni");
  });
});
