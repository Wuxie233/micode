import { describe, expect, it } from "bun:test";

import { primaryAgent } from "@/agents/commander";

describe("commander completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(primaryAgent.prompt).toContain("<completion-notify");
  });

  it("references the default private QQ user 445714414", () => {
    expect(primaryAgent.prompt).toContain("445714414");
  });

  it("instructs the agent to skip manual notification for lifecycle terminal states", () => {
    expect(primaryAgent.prompt).toMatch(/lifecycle.*already emits/);
  });

  it("lists the three terminal states", () => {
    expect(primaryAgent.prompt).toContain("completed");
    expect(primaryAgent.prompt).toContain("blocked");
    expect(primaryAgent.prompt).toContain("failed-stop");
  });

  it("forbids notifying intermediate phases", () => {
    expect(primaryAgent.prompt).toContain("plan creation");
    expect(primaryAgent.prompt).toContain("reviewer cycles");
  });
});
