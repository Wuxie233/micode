import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";
import { executorAgent } from "@/agents/executor";
import { octtoAgent } from "@/agents/octto";

const coordinatorPrompts = [
  { name: "brainstormer", prompt: brainstormerAgent.prompt ?? "" },
  { name: "commander", prompt: commanderAgent.prompt ?? "" },
  { name: "executor", prompt: executorAgent.prompt ?? "" },
  { name: "octto", prompt: octtoAgent.prompt ?? "" },
];

describe("context capsule shared protocol drift guard", () => {
  it("injects the shared protocol into all coordinator prompts", () => {
    for (const { name, prompt } of coordinatorPrompts) {
      expect(prompt, `${name} prompt`).toContain(CONTEXT_CAPSULE_PROTOCOL);
    }
  });

  it("preserves critical context capsule commitments", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("user prompt TOP");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Never inject capsule content into a system prompt");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("byte-identical");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("worker still must read its own target files");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("(conversation_anchor, branch, worktree)");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("OpenCode restart");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Capsule status");
  });
});

describe("context capsule v2 hook drift guard", () => {
  const v2CoordinatorPrompts = [
    { name: "brainstormer", prompt: brainstormerAgent.prompt ?? "" },
    { name: "commander", prompt: commanderAgent.prompt ?? "" },
    { name: "octto", prompt: octtoAgent.prompt ?? "" },
  ];

  it("keeps v2 hook and dispatch trigger contract in all primary prompts", () => {
    for (const { name, prompt } of v2CoordinatorPrompts) {
      expect(prompt, `${name} prompt`).toContain("<context-capsule-v2-hook");
      expect(prompt, `${name} prompt`).toContain("派遣前查找+复用、派遣后生成");
      expect(prompt, `${name} prompt`).toContain("executor-direct");
    }
  });
});

describe("executor context capsule drift guard", () => {
  const prompt = executorAgent.prompt ?? "";

  it("injects the shared context capsule protocol", () => {
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  });

  it("keeps capsule/context-brief/review-policy ordering phrases explicit", () => {
    expect(prompt).toContain("<context-brief");
    expect(prompt).toContain("capsule in front, context-brief after");
    expect(prompt).toContain("<context-brief> remains mandatory");
    expect(prompt).toContain("capsule never replaces review policy");
  });
});

describe("commander context capsule drift guard", () => {
  const prompt = commanderAgent.prompt ?? "";

  it("injects the shared context capsule protocol", () => {
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  });

  it("keeps same-lifecycle sequential reuse reporting explicit", () => {
    expect(prompt).toContain("A→B");
    expect(prompt).toContain("Capsule status");
  });
});

describe("brainstormer context capsule drift guard", () => {
  const prompt = brainstormerAgent.prompt ?? "";

  it("injects the shared context capsule protocol", () => {
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  });

  it("keeps capsule use before swarm and exploration fan-out", () => {
    expect(prompt).toContain("Lens Swarm");
    expect(prompt).toContain("critic/adversarial fan-out");
    expect(prompt).toContain("single specialist dispatches");
    expect(prompt).toContain("single specialist Task");
    expect(prompt).toContain("exploration fan-out");
    expect(prompt).toContain("A→B reuse");
  });
});

describe("octto context capsule drift guard", () => {
  const prompt = octtoAgent.prompt ?? "";

  it("injects the shared context capsule protocol", () => {
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  });

  it("keeps v2 hook, trigger coverage, and auto-resume reuse explicit", () => {
    expect(prompt).toContain('<context-capsule-v2-hook scope="octto">');
    expect(prompt).toContain("find_reusable_context_capsule");
    expect(prompt).toContain("build_context_capsule");
    expect(prompt).toContain("executor-direct");
    expect(prompt).toContain("auto-resume");
    expect(prompt).toContain("reuse the most recent capsule");
  });
});
