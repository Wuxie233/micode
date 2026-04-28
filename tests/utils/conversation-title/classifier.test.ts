import { describe, expect, it } from "bun:test";

import { classifyToolMilestone, TITLE_STATUS } from "@/utils/conversation-title";
import { TITLE_SOURCE } from "@/utils/conversation-title/source";

describe("classifyToolMilestone", () => {
  it("recognizes a design write under thoughts/shared/plans/", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-27-foo-design.md", content: "..." },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("foo");
    expect(signal?.source).toBe(TITLE_SOURCE.DESIGN_PATH);
  });

  it("recognizes a plan write under thoughts/shared/plans/", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { path: "thoughts/shared/plans/2026-04-27-foo.md", content: "..." },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("foo");
    expect(signal?.source).toBe(TITLE_SOURCE.PLAN_PATH);
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
    expect(signal?.source).toBe(TITLE_SOURCE.LIFECYCLE_ISSUE);
  });

  it("maps lifecycle_commit to executing", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 1, scope: "title", summary: "wire hook" },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
    expect(signal?.summary).toBe("wire hook");
    expect(signal?.source).toBe(TITLE_SOURCE.COMMIT_TITLE);
  });

  it("maps lifecycle_finish to done when output mentions closed", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 1 },
      output: "merged and closed",
    });
    expect(signal?.status).toBe(TITLE_STATUS.DONE);
    expect(signal?.summary).toBeNull();
    expect(signal?.source).toBe(TITLE_SOURCE.LIFECYCLE_FINISH);
  });

  it("maps lifecycle_finish without closed marker to executing", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 1 },
      output: "still in progress",
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
    expect(signal?.summary).toBeNull();
    expect(signal?.source).toBe(TITLE_SOURCE.LIFECYCLE_FINISH);
  });

  it("recognizes spawn_agent with implementer-* agents", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: [{ agent: "implementer-frontend", prompt: "x", description: "y" }] },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
    expect(signal?.summary).toBeNull();
    expect(signal?.source).toBe(TITLE_SOURCE.COMMIT_TITLE);
  });

  it("recognizes spawn_agent with executor agent", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: { agent: "executor", prompt: "x", description: "y" } },
    });
    expect(signal?.status).toBe(TITLE_STATUS.EXECUTING);
    expect(signal?.summary).toBeNull();
    expect(signal?.source).toBe(TITLE_SOURCE.COMMIT_TITLE);
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
