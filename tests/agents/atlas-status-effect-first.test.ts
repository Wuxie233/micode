import { describe, expect, it } from "bun:test";
import { ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";
import { renderAtlasStatusLine } from "@/atlas/atlas-status";

describe("effect-first + atlas-status coexistence", () => {
  for (const [name, agent] of [
    ["brainstormer", brainstormerAgent] as const,
    ["commander", commanderAgent] as const,
    ["octto", octtoAgent] as const,
  ]) {
    it(`${name} carries both effect-first and atlas-mental-model blocks`, () => {
      const p = agent.prompt ?? "";
      // brainstormer + commander 强制中文 effect-first；octto 语义对齐
      const hasEffectFirst = p.includes("effect-first-reporting") || p.includes("预期表现");
      expect(hasEffectFirst).toBe(true);
      expect(p).toContain("<atlas-mental-model");
    });
  }

  it("renderAtlasStatusLine emits values from ATLAS_STATUS_VALUES", () => {
    for (const v of ATLAS_STATUS_VALUES) {
      expect(renderAtlasStatusLine(v)).toBe(`Atlas status: ${v}`);
    }
  });
});
