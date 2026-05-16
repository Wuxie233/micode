import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";

const extract = (source: string, tag: string): string =>
  source.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? "";

describe("brainstormer conflict recovery UX", () => {
  it("keeps commander and brainstormer action-map byte-identical after conflict resolver update", () => {
    expect(extract(BRAINSTORMER_PROMPT, "action-map")).toBe(extract(COMMANDER_PROMPT, "action-map"));
  });

  it("contains question-first and decision-minimal protocols", () => {
    expect(BRAINSTORMER_PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
    expect(BRAINSTORMER_PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(BRAINSTORMER_PROMPT).toContain("conflict resolver flow");
  });
});
