import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";
import { executorAgent } from "@/agents/executor";

const coordinatorPrompts = [
  { name: "brainstormer", prompt: brainstormerAgent.prompt ?? "" },
  { name: "commander", prompt: commanderAgent.prompt ?? "" },
  { name: "executor", prompt: executorAgent.prompt ?? "" },
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
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Capsule status");
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
    expect(prompt).toContain("exploration fan-out");
    expect(prompt).toContain("A→B reuse");
  });
});
