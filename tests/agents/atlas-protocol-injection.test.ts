import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { octtoAgent } from "@/agents/octto";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

describe("atlas-mental-model protocol drift guard", () => {
  const cases: ReadonlyArray<readonly [string, { readonly prompt?: string }]> = [
    ["brainstormer", brainstormerAgent],
    ["planner", plannerAgent],
    ["executor", executorAgent],
    ["reviewer", reviewerAgent],
    ["commander", commanderAgent],
    ["octto", octtoAgent],
  ];

  for (const [name, agent] of cases) {
    it(`${name} injects ATLAS_MENTAL_MODEL_PROTOCOL exactly once`, () => {
      expect(agent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
      const matches = (agent.prompt ?? "").match(/<atlas-mental-model/gu) ?? [];
      expect(matches.length).toBe(1);
    });
  }

  it("ATLAS_MENTAL_MODEL_PROTOCOL itself contains all required status values", () => {
    const required = ["consulted", "no-change", "delta-created", "stale-detected", "blocked", "cannot-assess"];
    for (const v of required) {
      expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain(v);
    }
  });
});
