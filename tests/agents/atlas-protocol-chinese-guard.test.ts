import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";
import { plannerAgent } from "@/agents/planner";

describe("atlas chinese-content-guard reach", () => {
  const checks = ["中文优先", "frontmatter", "wikilink", "file paths", "tool names", "code symbols"];

  it("brainstormer prompt contains all chinese-guard keywords", () => {
    for (const key of checks) {
      expect(brainstormerAgent.prompt).toContain(key);
    }
  });

  it("planner prompt contains all chinese-guard keywords", () => {
    for (const key of checks) {
      expect(plannerAgent.prompt).toContain(key);
    }
  });
});
