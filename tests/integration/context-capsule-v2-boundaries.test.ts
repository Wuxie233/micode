import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";

const v2HookPrompts = [
  { name: "commander", prompt: commanderAgent.prompt ?? "", scope: "commander" },
  { name: "brainstormer", prompt: brainstormerAgent.prompt ?? "", scope: "brainstormer" },
  { name: "octto", prompt: octtoAgent.prompt ?? "", scope: "octto" },
];

function extractV2HookBlock(prompt: string, scope: string): string {
  const match = prompt.match(
    new RegExp(`<context-capsule-v2-hook\\b[^>]*scope="${scope}"[^>]*>[\\s\\S]*?</context-capsule-v2-hook>`),
  );
  expect(match, `${scope} context-capsule-v2-hook block`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("context capsule v2 hook boundary guard", () => {
  it("keeps commander/brainstormer/octto v2 hooks present", () => {
    for (const { name, prompt, scope } of v2HookPrompts) {
      expect(extractV2HookBlock(prompt, scope), `${name} v2 hook`).toContain("<context-capsule-v2-hook");
    }
  });

  it("does not extend resume_subagent semantics from v2 hooks", () => {
    for (const { name, prompt, scope } of v2HookPrompts) {
      const hookBlock = extractV2HookBlock(prompt, scope);
      expect(hookBlock, `${name} v2 hook`).not.toContain("resume_subagent");
    }
  });

  it("does not replace or supersede context-brief from v2 hooks", () => {
    for (const { name, prompt, scope } of v2HookPrompts) {
      const hookBlock = extractV2HookBlock(prompt, scope).toLowerCase();
      expect(hookBlock, `${name} v2 hook`).not.toMatch(/replace[^\n.]*context-brief/);
      expect(hookBlock, `${name} v2 hook`).not.toMatch(/supersede[^\n.]*context-brief/);
      expect(hookBlock, `${name} v2 hook`).not.toMatch(/context-brief[^\n.]*(replace|supersede)/);
    }
  });

  it("does not authorize Project Memory or Atlas writes from v2 hooks", () => {
    for (const { name, prompt, scope } of v2HookPrompts) {
      const hookBlock = extractV2HookBlock(prompt, scope);
      expect(hookBlock, `${name} v2 hook`).not.toContain("project_memory_promote");
      expect(hookBlock, `${name} v2 hook`).not.toContain("atlas_write");
      expect(hookBlock, `${name} v2 hook`).not.toContain("write to Atlas");
    }
  });

  it("does not introduce lifecycle recovery semantics from v2 hooks", () => {
    for (const { name, prompt, scope } of v2HookPrompts) {
      const hookBlock = extractV2HookBlock(prompt, scope);
      expect(hookBlock, `${name} v2 hook`).not.toContain("lifecycle_recovery_decision");
      expect(hookBlock, `${name} v2 hook`).not.toContain("Recovery hint");
    }
  });
});
