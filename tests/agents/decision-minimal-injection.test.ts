import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { implementerAgent } from "@/agents/implementer";
import { octtoAgent } from "@/agents/octto";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

const PROMPTS = {
  commander: COMMANDER_PROMPT,
  brainstormer: BRAINSTORMER_PROMPT,
  octto: octtoAgent.prompt ?? "",
  planner: plannerAgent.prompt ?? "",
  executor: executorAgent.prompt ?? "",
  reviewer: reviewerAgent.prompt ?? "",
  implementer: implementerAgent.prompt ?? "",
};

const extractBlock = (source: string, tag: string): string =>
  source.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? "";

describe("decision-minimal prompt injection", () => {
  it("injects decision-minimal response guidance into all relevant agents", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      expect(prompt, name).toContain("decision-minimal");
      expect(prompt, name).toContain("raw recovery hint");
    }
  });

  it("injects question-first guidance into decision-owning agents", () => {
    for (const [name, prompt] of Object.entries({
      commander: COMMANDER_PROMPT,
      brainstormer: BRAINSTORMER_PROMPT,
      octto: PROMPTS.octto,
      executor: PROMPTS.executor,
    })) {
      expect(prompt, name).toContain("built-in question");
      expect(prompt, name).toContain("plain chat");
    }
  });

  it("preserves commander/brainstormer byte-identical guarded blocks", () => {
    expect(extractBlock(COMMANDER_PROMPT, "action-map")).toBe(extractBlock(BRAINSTORMER_PROMPT, "action-map"));
    expect(extractBlock(COMMANDER_PROMPT, "effect-first-reporting")).toBe(
      extractBlock(BRAINSTORMER_PROMPT, "effect-first-reporting"),
    );
  });
});
