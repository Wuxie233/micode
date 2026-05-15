import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brainstormScoutAgent } from "@/agents/brainstorm-scout";
import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { LENS_SWARM_PROTOCOL } from "@/agents/lens-swarm-protocol";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

const ROOT = join(__dirname, "..", "..");
const AGENTS_MD = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");

describe("Lens Swarm drift guard", () => {
  it("keeps shared protocol injected into scout and coordinator prompts", () => {
    expect(brainstormScoutAgent.prompt).toContain(LENS_SWARM_PROTOCOL);
    expect(brainstormerAgent.prompt).toContain(LENS_SWARM_PROTOCOL);
    expect(commanderAgent.prompt).toContain(LENS_SWARM_PROTOCOL);
  });

  it("keeps Discovery Swarm on brainstormer only", () => {
    expect(brainstormerAgent.prompt).toContain("Discovery Swarm");
    expect(brainstormerAgent.prompt).toContain("before planner");
    expect(commanderAgent.prompt).not.toContain("<discovery-swarm-before-planner");
  });

  it("keeps Adversarial Swarm and critic compatibility in both coordinators", () => {
    for (const prompt of [brainstormerAgent.prompt ?? "", commanderAgent.prompt ?? ""]) {
      expect(prompt).toContain("Adversarial Swarm");
      expect(prompt).toContain("explicit critic-role compatibility");
      expect(prompt).toContain("redteam");
      expect(prompt).toContain("yagni");
    }
  });

  it("keeps planner/executor/reviewer review policy vocabulary aligned", () => {
    for (const prompt of [plannerAgent.prompt ?? "", executorAgent.prompt ?? "", reviewerAgent.prompt ?? ""]) {
      expect(prompt).toContain("review policy");
      expect(prompt).toContain("risk observation");
      expect(prompt).toContain("mandatory");
    }

    expect(plannerAgent.prompt).toContain("reviewer-skip eligible");
    expect(executorAgent.prompt).toContain("review skipped: low-risk whitelist");
    expect(reviewerAgent.prompt).toContain("missing review policy");
  });

  it("keeps AGENTS.md mirror aligned with key workflow terms", () => {
    expect(AGENTS_MD).toContain("Lens Swarm protocol");
    expect(AGENTS_MD).toContain("brainstorm-scout");
    expect(AGENTS_MD).toContain("Discovery Swarm");
    expect(AGENTS_MD).toContain("Adversarial Swarm");
    expect(AGENTS_MD).toContain("whitelist");
    expect(AGENTS_MD).toContain("critic");
  });

  it("does not accidentally route scout through executor output-class", () => {
    const commanderSource = readFileSync(join(ROOT, "src", "agents", "commander.ts"), "utf-8");
    const brainstormerSource = readFileSync(join(ROOT, "src", "agents", "brainstormer.ts"), "utf-8");

    expect(commanderSource).not.toMatch(/<output-class[^>]*agent="brainstorm-scout"/);
    expect(brainstormerSource).not.toMatch(/<output-class[^>]*agent="brainstorm-scout"/);
  });
});
