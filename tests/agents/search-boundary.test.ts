import { describe, expect, it } from "bun:test";

import { codebaseAnalyzerAgent } from "@/agents/codebase-analyzer";
import { codebaseLocatorAgent } from "@/agents/codebase-locator";
import { patternFinderAgent } from "@/agents/pattern-finder";

const AGENTS = [
  { name: "codebase-locator", prompt: codebaseLocatorAgent.prompt },
  { name: "codebase-analyzer", prompt: codebaseAnalyzerAgent.prompt },
  { name: "pattern-finder", prompt: patternFinderAgent.prompt },
] as const;

const REQUIRED_RULES = [
  /Stay rooted in the ACTIVE project \/ worktree only/i,
  /Do NOT traverse sibling `?issue-\*`? worktrees/i,
  /exclude `?\.git`?,\s*`?node_modules`?,\s*`?dist`?/i,
  /Only widen the scope.*explicitly asks/i,
] as const;

describe("locator-style agent search-scope guardrail", () => {
  for (const agent of AGENTS) {
    describe(agent.name, () => {
      it("includes exactly one <search-scope> block", () => {
        const opens = (agent.prompt ?? "").match(/<search-scope>/g) ?? [];
        const closes = (agent.prompt ?? "").match(/<\/search-scope>/g) ?? [];
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
      });

      it("places the <search-scope> block before <purpose>", () => {
        const prompt = agent.prompt ?? "";
        const scopeIdx = prompt.indexOf("<search-scope>");
        const purposeIdx = prompt.indexOf("<purpose>");
        expect(scopeIdx).toBeGreaterThan(-1);
        expect(purposeIdx).toBeGreaterThan(-1);
        expect(scopeIdx).toBeLessThan(purposeIdx);
      });

      for (const pattern of REQUIRED_RULES) {
        it(`<search-scope> matches ${pattern}`, () => {
          expect(agent.prompt ?? "").toMatch(pattern);
        });
      }
    });
  }

  it("all three agents share byte-identical <search-scope> contents", () => {
    const blocks = AGENTS.map((a) => {
      const match = (a.prompt ?? "").match(/<search-scope>[\s\S]*?<\/search-scope>/);
      return match ? match[0] : null;
    });
    expect(blocks[0]).not.toBeNull();
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
  });
});
