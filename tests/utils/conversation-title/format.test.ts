import { describe, expect, it } from "bun:test";

import { buildTitle, summaryFromPlanPath, summaryFromUserMessage, TITLE_STATUS } from "@/utils/conversation-title";

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
