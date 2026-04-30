import { describe, expect, it } from "bun:test";

import {
  buildIssueAwareTitle,
  buildTitle,
  summaryFromPlanPath,
  summaryFromUserMessage,
  TITLE_STATUS,
} from "@/utils/conversation-title";

describe("buildTitle", () => {
  it("joins status and summary with a colon and ascii space", () => {
    expect(buildTitle({ status: TITLE_STATUS.EXECUTING, summary: "自动重命名" })).toBe("执行中: 自动重命名");
  });

  it("returns status alone when summary is empty", () => {
    expect(buildTitle({ status: TITLE_STATUS.PLANNING, summary: "" })).toBe(TITLE_STATUS.PLANNING);
  });

  it("normalizes runs of whitespace inside the summary", () => {
    expect(buildTitle({ status: TITLE_STATUS.EXECUTING, summary: "fix\n  bug \t now" })).toBe("执行中: fix bug now");
  });

  it("truncates summary with an ellipsis when total exceeds maxLength", () => {
    const summary = "0123456789".repeat(8);
    const title = buildTitle({ status: TITLE_STATUS.EXECUTING, summary }, 20);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.startsWith("执行中: ")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to truncated status when even the prefix overflows maxLength", () => {
    const title = buildTitle({ status: TITLE_STATUS.EXECUTING, summary: "anything" }, 1);
    expect(title.length).toBeLessThanOrEqual(1);
  });
});

describe("buildIssueAwareTitle", () => {
  it("formats issue-prefixed executing state with full-width colon", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中：优化主会话标题生成");
  });

  it("formats issue-prefixed done state with full-width colon", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.DONE,
      }),
    ).toBe("#13 已完成：优化主会话标题生成");
  });

  it("formats issue-prefixed failed state", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 7,
        topic: "修复登录",
        status: TITLE_STATUS.FAILED,
      }),
    ).toBe("#7 失败：修复登录");
  });

  it("falls back to topic title when issueNumber is null", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: null,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("优化主会话标题生成");
  });

  it("falls back to topic title with conclusive suffix when issueNumber is null and status is DONE", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: null,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.DONE,
      }),
    ).toBe("优化主会话标题生成 · 已完成");
  });

  it("emits status alone when topic is empty and issueNumber is provided", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中");
  });

  it("emits status alone when topic is whitespace and issueNumber is provided", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "   ",
        status: TITLE_STATUS.PLANNING,
      }),
    ).toBe("#13 规划中");
  });

  it("truncates only the topic and preserves the issue prefix", () => {
    const longTopic = "优".repeat(80);
    const title = buildIssueAwareTitle(
      {
        issueNumber: 999,
        topic: longTopic,
        status: TITLE_STATUS.EXECUTING,
      },
      30,
    );
    expect(title.startsWith("#999 执行中：")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to status alone when even the prefix overflows maxLength", () => {
    const title = buildIssueAwareTitle(
      {
        issueNumber: 13,
        topic: "anything",
        status: TITLE_STATUS.EXECUTING,
      },
      3,
    );
    expect(title.length).toBeLessThanOrEqual(3);
  });

  it("normalizes whitespace inside the topic", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "fix\n  bug \t now",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中：fix bug now");
  });

  it("legacy buildTitle still uses ASCII colon", () => {
    expect(buildTitle({ status: TITLE_STATUS.EXECUTING, summary: "x" })).toBe("执行中: x");
  });

  it("plan path helpers still work", () => {
    expect(summaryFromPlanPath("thoughts/shared/plans/2026-04-30-foo-design.md")).toBe("foo");
    expect(summaryFromUserMessage("hi")).toBe("hi");
  });
});

describe("summaryFromPlanPath", () => {
  it("strips date prefix and -design suffix from a plan slug", () => {
    expect(summaryFromPlanPath("thoughts/shared/plans/2026-04-27-auto-conversation-title-design.md")).toBe(
      "auto conversation title",
    );
  });

  it("returns null for non-plan paths", () => {
    expect(summaryFromPlanPath("src/index.ts")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(summaryFromPlanPath(null)).toBeNull();
    expect(summaryFromPlanPath(undefined)).toBeNull();
  });
});

describe("summaryFromUserMessage", () => {
  it("trims and collapses whitespace", () => {
    expect(summaryFromUserMessage("  hello   world  ")).toBe("hello world");
  });

  it("caps at 60 characters", () => {
    const long = "x".repeat(120);
    const result = summaryFromUserMessage(long);
    expect(result).toBeDefined();
    expect((result as string).length).toBe(60);
  });

  it("returns null for empty inputs", () => {
    expect(summaryFromUserMessage("")).toBeNull();
    expect(summaryFromUserMessage("   ")).toBeNull();
    expect(summaryFromUserMessage(null)).toBeNull();
  });
});
