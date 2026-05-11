import { describe, expect, it } from "bun:test";
import { PROJECT_MEMORY_PROTOCOL, PROJECT_MEMORY_STATUS_VALUES } from "@/agents/project-memory-protocol";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { octtoAgent } from "@/agents/octto";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

describe("project-memory-protocol drift guard", () => {
  const cases: ReadonlyArray<readonly [string, { readonly prompt?: string }]> = [
    ["brainstormer", brainstormerAgent],
    ["planner", plannerAgent],
    ["executor", executorAgent],
    ["reviewer", reviewerAgent],
    ["commander", commanderAgent],
    ["octto", octtoAgent],
  ];

  for (const [name, agent] of cases) {
    it(`${name} injects PROJECT_MEMORY_PROTOCOL exactly once`, () => {
      expect(agent.prompt).toContain(PROJECT_MEMORY_PROTOCOL);
      const matches = (agent.prompt ?? "").match(/<project-memory-protocol/gu) ?? [];
      expect(matches.length).toBe(1);
    });
  }

  describe("PROJECT_MEMORY_PROTOCOL body", () => {
    it("contains all four protocol verbs", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Read">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Maintain">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Verify">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Report">');
    });

    it("declares lifecycle no longer auto-promotes", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("lifecycle_finish");
      expect(PROJECT_MEMORY_PROTOCOL).toMatch(/不再自动 promote|不允许隐式写|no longer auto-promotes/);
    });

    it("declares leaf-agent boundary explicitly", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("role-of-leaf-agents");
      // Leaf agents never write
      expect(PROJECT_MEMORY_PROTOCOL).toMatch(/永远不调用 project_memory_promote|do not call project_memory_promote/);
    });

    it("exports the canonical status value list", () => {
      expect(PROJECT_MEMORY_STATUS_VALUES).toEqual([
        "read-only",
        "wrote-decision",
        "wrote-lesson",
        "wrote-risk",
        "wrote-open-question",
        "no-change",
        "cannot-assess",
      ]);
    });

    it("references all status values in the protocol body", () => {
      for (const status of PROJECT_MEMORY_STATUS_VALUES) {
        expect(PROJECT_MEMORY_PROTOCOL).toContain(status);
      }
    });

    it("describes the three-way distinction with Atlas and Mindmodel", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("Atlas");
      expect(PROJECT_MEMORY_PROTOCOL).toContain("Mindmodel");
      expect(PROJECT_MEMORY_PROTOCOL).toContain(".mindmodel/");
    });
  });
});
