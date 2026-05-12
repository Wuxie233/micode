import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { plannerAgent } from "@/agents/planner";

const PLANNER_PROMPT = plannerAgent.prompt ?? "";
const EXECUTOR_PROMPT = executorAgent.prompt ?? "";

const PROMPTS = {
  brainstormer: BRAINSTORMER_PROMPT,
  commander: COMMANDER_PROMPT,
  planner: PLANNER_PROMPT,
  executor: EXECUTOR_PROMPT,
};

function extractBlock(prompt: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`);
  const match = prompt.match(pattern);

  expect(match, `expected <${tagName}> block`).not.toBeNull();

  return match?.[1] ?? "";
}

describe("lifecycle recovery prompt drift guard", () => {
  it("keeps bounded recovery loop in both primary lifecycle owners", () => {
    expect(BRAINSTORMER_PROMPT).toContain("<bounded-recovery-loop");
    expect(COMMANDER_PROMPT).toContain("<bounded-recovery-loop");
  });

  it("keeps brainstormer and commander action-map blocks byte-identical", () => {
    const brainstormerActionBlock = extractBlock(BRAINSTORMER_PROMPT, "action-map");
    const commanderActionBlock = extractBlock(COMMANDER_PROMPT, "action-map");

    expect(commanderActionBlock).toBe(brainstormerActionBlock);
  });

  it("limits planner lifecycle recovery to max 2 rounds", () => {
    expect(PLANNER_PROMPT).toMatch(/max 2 recovery rounds/i);
    expect(PLANNER_PROMPT).not.toMatch(/max(?:imum)? 3 recovery rounds/i);
  });

  it("keeps executor handoff metadata in final report and never calls lifecycle_finish", () => {
    expect(EXECUTOR_PROMPT).toContain(
      "include failure_kind, recommended_next_action, and summary verbatim in your final report",
    );
    expect(EXECUTOR_PROMPT).toContain("brainstormer can recover");
    expect(EXECUTOR_PROMPT).toContain("Never call lifecycle_finish");
  });

  it("removes legacy single-attempt halt language from lifecycle-capable agents", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      expect(prompt, name).not.toContain("Single attempt per call. Do not retry on failure");
      expect(prompt, name).not.toContain("invocation with no retry");
      expect(prompt, name).not.toContain("If a tool reports failure, surface it to the user and halt");
    }
  });

  it("keeps unsafe git recovery shortcuts explicitly forbidden in all lifecycle-capable prompts", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      expect(prompt, name).toContain("--force");
      expect(prompt, name).toContain("--no-verify");
      expect(prompt, name).toContain("reset --hard");
    }
  });
});
