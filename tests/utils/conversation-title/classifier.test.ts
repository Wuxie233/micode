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

describe("classifyToolMilestone - issue number extraction", () => {
  it("extracts issue number from lifecycle_start_request output table", () => {
    const output = [
      "| Issue # | Branch | Worktree | State |",
      "|---|---|---|---|",
      "| 13 | `issue/13-foo` | `/tmp/wt-13-foo` | `planning` |",
    ].join("\n");

    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      output,
    });

    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("优化主会话标题生成");
    expect(signal?.source).toBe(TITLE_SOURCE.LIFECYCLE_ISSUE);
    expect(signal?.issueNumber).toBe(13);
  });

  it("falls back to issue/<N>- branch slug when table row is missing", () => {
    const output = "## Lifecycle pre-flight failed\n\nbranch was issue/27-foo before abort";
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "x", goals: [], constraints: [] },
      output,
    });
    expect(signal?.issueNumber).toBe(27);
  });

  it("returns null issueNumber when start output has no parseable number", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "x", goals: [], constraints: [] },
      output: "(empty)",
    });
    expect(signal?.issueNumber).toBeNull();
  });

  it("reads issue_number from lifecycle_commit args", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 13, scope: "title", summary: "wire hook" },
    });
    expect(signal?.issueNumber).toBe(13);
    expect(signal?.summary).toBe("wire hook");
  });

  it("reads issue_number from lifecycle_finish args", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 13 },
      output: "merged and closed",
    });
    expect(signal?.status).toBe(TITLE_STATUS.DONE);
    expect(signal?.issueNumber).toBe(13);
  });

  it("rejects tool-like summaries from lifecycle_commit", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 13, scope: "title", summary: "executor" },
    });
    expect(signal?.summary).toBeNull();
    expect(signal?.issueNumber).toBe(13);
  });

  it("rejects tool-like summaries from lifecycle_start_request", () => {
    const output = "| 13 | `issue/13-x` | `/tmp/x` | `planning` |";
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "spawn_agent", goals: [], constraints: [] },
      output,
    });
    expect(signal?.summary).toBeNull();
    expect(signal?.issueNumber).toBe(13);
  });

  it("ignores invalid issue_number values", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: -3, scope: "x", summary: "fix" },
    });
    expect(signal?.issueNumber).toBeNull();

    const signalString = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: "13", scope: "x", summary: "fix" },
    });
    expect(signalString?.issueNumber).toBeNull();
  });

  it("plan write keeps issueNumber null", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-30-foo.md" },
    });
    expect(signal?.issueNumber).toBeNull();
  });

  it("spawn_agent for implementer keeps issueNumber null and summary null", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: [{ agent: "implementer-frontend", prompt: "x", description: "y" }] },
    });
    expect(signal?.issueNumber).toBeNull();
    expect(signal?.summary).toBeNull();
  });

  it("recognizes plan write under thoughts/shared/plans/", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-30-foo-design.md" },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("foo");
    expect(signal?.source).toBe(TITLE_SOURCE.DESIGN_PATH);
  });
});
