import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";

describe("brainstormer completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(brainstormerAgent.prompt).toContain("<completion-notify");
  });

  it("instructs brainstormer to defer to lifecycle for lifecycle-driven work", () => {
    expect(brainstormerAgent.prompt).toMatch(/lifecycle.*already emits/);
  });

  it("references default private QQ user 445714414", () => {
    expect(brainstormerAgent.prompt).toContain("445714414");
  });
});
