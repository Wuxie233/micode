import { describe, expect, it } from "bun:test";

import { classifyToolMilestone, TITLE_STATUS } from "@/utils/conversation-title";

describe("classifyToolMilestone", () => {
  it("recognizes a plan write under thoughts/shared/plans/", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-27-foo-design.md", content: "..." },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("foo");
  });

  it("ignores write to other directories", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "src/index.ts" },
    });
    expect(signal).toBeNull();
  });

  it("maps lifecycle_start_request with summary arg", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "auto conversation title", goals: [], constraints: [] },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("auto conversation title");
  });

  it("maps lifecycle_commit to executing", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 1, scope: "title", summary: "wire hook" },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
    expect(signal?.summary).toBe("wire hook");
  });

  it("maps lifecycle_finish to done when output mentions closed", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 1 },
      output: "merged and closed",
    });
    expect(signal?.status).toBe(TITLE_STATUS.DONE);
  });

  it("maps lifecycle_finish without closed marker to executing", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 1 },
      output: "still in progress",
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
  });

  it("recognizes spawn_agent with implementer-* agents", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: [{ agent: "implementer-frontend", prompt: "x", description: "y" }] },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
  });

  it("recognizes spawn_agent with executor agent", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: { agent: "executor", prompt: "x", description: "y" } },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
  });

  it("ignores spawn_agent for other agent types", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: [{ agent: "codebase-locator", prompt: "x", description: "y" }] },
    });
    expect(signal).toBeNull();
  });

  it("ignores unknown tools", () => {
    expect(classifyToolMilestone({ tool: "read", args: { filePath: "anything.md" } })).toBeNull();
  });
});
