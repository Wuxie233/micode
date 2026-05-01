import { describe, expect, it } from "bun:test";

import { buildSpawnCompletionTitle, buildSpawnRunningTitle } from "@/tools/spawn-agent/naming";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

describe("buildSpawnRunningTitle", () => {
  it("uses 执行中 status with description as summary when description provided", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
      }),
    ).toBe("执行中: 修复后端权限校验");
  });

  it("falls back to Chinese role label when description is missing", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "implementer-backend",
        description: "",
      }),
    ).toBe("执行中: 后端实现");
  });

  it("falls back to Chinese role label when description is whitespace only", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "reviewer",
        description: "   ",
      }),
    ).toBe("执行中: 代码审查");
  });

  it("strips spawn-agent. prefix from unknown agent name in fallback", () => {
    expect(
      buildSpawnRunningTitle({
        agent: "spawn-agent.weird-tool",
        description: "",
      }),
    ).toBe("执行中: weird-tool");
  });

  it("truncates long description but always preserves status prefix", () => {
    const longDescription = "这是一段非常非常非常非常非常非常非常非常非常非常长的任务描述用来测试截断逻辑";
    const title = buildSpawnRunningTitle({ agent: "reviewer", description: longDescription }, 20);

    expect(title.startsWith("执行中: ")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns 执行中: 子任务 when both description and agent are empty", () => {
    expect(buildSpawnRunningTitle({ agent: "", description: "" })).toBe("执行中: 子任务");
  });
});

describe("buildSpawnCompletionTitle", () => {
  it("maps success outcome to 已完成 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
        outcome: SPAWN_OUTCOMES.SUCCESS,
      }),
    ).toBe("已完成: 修复后端权限校验");
  });

  it("maps blocked outcome to 阻塞 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
        outcome: SPAWN_OUTCOMES.BLOCKED,
      }),
    ).toBe("阻塞: 修复后端权限校验");
  });

  it("maps task_error outcome to 失败 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
        outcome: SPAWN_OUTCOMES.TASK_ERROR,
      }),
    ).toBe("失败: 修复后端权限校验");
  });

  it("maps hard_failure outcome to 失败 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "implementer-backend",
        description: "修复后端权限校验",
        outcome: SPAWN_OUTCOMES.HARD_FAILURE,
      }),
    ).toBe("失败: 修复后端权限校验");
  });

  it("maps review_changes_requested outcome to 需修改 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "审查 PR #42",
        outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      }),
    ).toBe("需修改: 审查 PR #42");
  });

  it("falls back to Chinese role label when description is missing", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "",
        outcome: SPAWN_OUTCOMES.SUCCESS,
      }),
    ).toBe("已完成: 代码审查");
  });

  it("falls back to reviewer label when review_changes_requested description is missing", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "",
        outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      }),
    ).toBe("需修改: 代码审查");
  });

  it("does not use 失败 status for review_changes_requested", () => {
    const title = buildSpawnCompletionTitle({
      agent: "reviewer",
      description: "审查 PR #42",
      outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    });

    expect(title.startsWith("失败")).toBe(false);
  });
});
