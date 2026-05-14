import { describe, expect, it } from "bun:test";
import { executorAgent } from "@/agents/executor";
import { BASE_IMPLEMENTER_PROMPT } from "@/agents/implementer";
import { implementerBackendAgent } from "@/agents/implementer-backend";
import { implementerFrontendCodeAgent } from "@/agents/implementer-frontend-code";
import { implementerFrontendUiAgent } from "@/agents/implementer-frontend-ui";
import { implementerGeneralAgent } from "@/agents/implementer-general";
import { reviewerAgent } from "@/agents/reviewer";

const LEAF_AGENTS = [
  ["implementer-base", BASE_IMPLEMENTER_PROMPT],
  ["implementer-frontend-ui", implementerFrontendUiAgent.prompt ?? ""],
  ["implementer-frontend-code", implementerFrontendCodeAgent.prompt ?? ""],
  ["implementer-backend", implementerBackendAgent.prompt ?? ""],
  ["implementer-general", implementerGeneralAgent.prompt ?? ""],
  ["reviewer", reviewerAgent.prompt ?? ""],
] as const;

describe("leaf agents do not write knowledge stores", () => {
  for (const [name, prompt] of LEAF_AGENTS) {
    describe(name, () => {
      it("never instructs the agent to call project_memory_promote", () => {
        // Soft check: leaf prompts may MENTION the tool name in a forbidding clause ("NEVER call ...").
        // What we forbid is any directive that says the agent SHOULD call promote.
        const promoteCallPattern = /(?:MUST|SHOULD|always)\s+call\s+project_memory_promote/i;
        expect(prompt).not.toMatch(promoteCallPattern);
      });

      it("never instructs the agent to call project_memory_forget", () => {
        const forgetCallPattern = /(?:MUST|SHOULD|always)\s+call\s+project_memory_forget/i;
        expect(prompt).not.toMatch(forgetCallPattern);
      });

      it("never instructs the agent to write atlas/ vault directly", () => {
        // No "modify atlas/" / "edit atlas/" / "call atlas write" directive
        const atlasWritePattern = /(?:MUST|SHOULD|always)\s+(?:modify|edit|write|update)\s+atlas\//i;
        expect(prompt).not.toMatch(atlasWritePattern);
      });

      it("never instructs the agent to call atlas_lookup", () => {
        // atlas_lookup is a tool reserved for primary/coordinator agents.
        // Leaf prompts may mention it in a forbidding clause but never as a directive.
        const lookupCallPattern = /(?:MUST|SHOULD|always)\s+call\s+atlas_lookup/i;
        expect(prompt).not.toMatch(lookupCallPattern);
      });

      it("does NOT contain mandatory project_memory_lookup wording (softened in Phase 2)", () => {
        // After Phase 2 the mandatory wording is replaced with "prefer brief, fallback to lookup".
        // This test catches accidental reverts.
        const mandatoryPattern = /(?:MUST|YOU MUST)\s+(?:also\s+)?call\s+project_memory_lookup/i;
        expect(prompt).not.toMatch(mandatoryPattern);
      });
    });
  }
});

describe("executor injects context-brief protocol", () => {
  const executorPrompt = executorAgent.prompt ?? "";

  it("declares the <context-brief> protocol block exactly once", () => {
    const opens = executorPrompt.match(/<context-brief[\s>]/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(1);
    // Must declare the protocol block itself
    expect(executorPrompt).toContain('<context-brief priority="critical"');
    expect(executorPrompt).toContain("</context-brief>");
  });

  it("defines the three child-protocol sections", () => {
    expect(executorPrompt).toContain("<confirmed>");
    expect(executorPrompt).toContain("<do-not-repeat>");
    expect(executorPrompt).toContain("<must-still-verify>");
  });

  it("specifies a size limit on context-brief", () => {
    expect(executorPrompt).toContain("4KB");
  });

  it("rules that EVERY spawn_agent to implementer/reviewer MUST include context-brief", () => {
    // The phrase MUST contain or include
    expect(executorPrompt).toMatch(/MUST (?:contain|include).*context-brief|context-brief.*MUST/i);
  });

  it("shows available-subagents spawn examples with context brief immediately after spawn-meta", () => {
    const availableSubagents = executorPrompt.match(/<available-subagents>[\s\S]*?<\/available-subagents>/)?.[0] ?? "";
    expect(availableSubagents).not.toBe("");

    const exampleAgents = [
      "implementer-frontend-ui",
      "implementer-frontend-code",
      "implementer-backend",
      "implementer-general",
      "reviewer",
    ];

    for (const agent of exampleAgents) {
      const invocation =
        availableSubagents.match(
          new RegExp(`spawn_agent\\(agent=["']${agent}["'][\\s\\S]*?(?=<\\/invocation>)`),
        )?.[0] ?? "";
      expect(invocation).not.toBe("");

      const afterSpawnMeta =
        invocation.match(/<spawn-meta\b[\s\S]*?\/>\s*([\s\S]*?)\s*(?:Implement|Review)\b/)?.[1] ?? "";
      expect(afterSpawnMeta).toMatch(/<context-brief\b|\[CONTEXT_BRIEF\]|\[BATCH1_CONTEXT_BRIEF\]/);
    }
  });
});

describe("leaf agents consume context-brief", () => {
  for (const [name, prompt] of LEAF_AGENTS) {
    if (name === "implementer-base") continue; // base prompt is composed into others
    it(`${name} contains a <context-brief-consumption> block`, () => {
      expect(prompt).toContain("<context-brief-consumption");
    });
    it(`${name} instructs to escalate on brief mismatch`, () => {
      expect(prompt).toMatch(/Brief mismatch/);
    });
  }
});
