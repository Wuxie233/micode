import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { buildHint } from "@/lifecycle/recovery/hint";
import { RECOVERY_SECTION_HEADER } from "@/lifecycle/recovery/hint-format";
import { StaleRecordError } from "@/lifecycle/resolver";
import { createLifecycleCommitTool } from "@/tools/lifecycle/commit";
import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";
import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";
import { createLifecycleResumeTool } from "@/tools/lifecycle/resume";

const TOOL_CONTEXT = {} as unknown as ToolContext;

const REQUIRED_HINT_LINES = [
  RECOVERY_SECTION_HEADER,
  "**failure_kind:** `",
  "**recommended_next_action:** `",
  "**safe_to_retry:** `",
  "**attempt:** `",
  "**summary:** ",
] as const;

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const execute = async (toolDef: { execute: unknown }, args: unknown): Promise<string> => {
  const exec = toolDef.execute as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
};

const expectRecoveryHintShape = (markdown: string): void => {
  for (const line of REQUIRED_HINT_LINES) {
    expect(markdown).toContain(line);
  }
};

describe("recovery hint shape contract", () => {
  it("lifecycle_finish failure path emits the required recovery hint fields", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: false,
        prUrl: null,
        closedAt: null,
        worktreeRemoved: false,
        cleanupOutcome: { kind: "failed", reason: "cleanup skipped", retried: false },
        note: "merge_conflict",
        recoveryHint: buildHint({
          failureKind: "merge_conflict",
          recommendedNextAction: "resolve_conflicts",
          safeToRetry: false,
          attempt: 2,
          summary: "conflicts remain",
          issueNumber: 67,
        }),
      }),
    });

    const output = await execute(tool, { issue_number: 67, merge_strategy: "auto", wait_for_checks: false });

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `merge_conflict`");
    expect(output).toContain("**recommended_next_action:** `resolve_conflicts`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `2`");
    expect(output).toContain("**summary:** conflicts remain");
  });

  it("lifecycle_commit failure path emits the required recovery hint fields", async () => {
    const tool = createLifecycleCommitTool({
      commit: async () => ({
        committed: false,
        sha: null,
        pushed: false,
        retried: false,
        note: "Staging failed",
        recoveryHint: buildHint({
          failureKind: "unknown",
          recommendedNextAction: "ask_user",
          safeToRetry: false,
          attempt: 3,
          summary: "staging failed",
          issueNumber: 67,
        }),
      }),
    });

    const output = await execute(tool, { issue_number: 67, scope: "lifecycle", summary: "shape", push: true });

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `unknown`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `3`");
    expect(output).toContain("**summary:** staging failed");
  });

  it("lifecycle_current ambiguous failure path emits the required recovery hint fields", async () => {
    const tool = createLifecycleCurrentTool({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          { issueNumber: 7, branch: null, worktree: null, state: "in_progress", stale: false, staleReason: null },
          {
            issueNumber: 67,
            branch: "issue/67-active",
            worktree: "/tmp/issue-67",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    });

    const output = await execute(tool, {});

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `ambiguous_lifecycle`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `1`");
    expect(output).toContain(
      "**summary:** Multiple lifecycle records match the current context; 2 candidate(s) found.",
    );
  });

  it("lifecycle_current ambiguous fresh-candidates path emits ask_user recovery hint fields", async () => {
    const tool = createLifecycleCurrentTool({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          {
            issueNumber: 7,
            branch: "issue/7-active",
            worktree: "/tmp/issue-7",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
          {
            issueNumber: 67,
            branch: "issue/67-active",
            worktree: "/tmp/issue-67",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    });

    const output = await execute(tool, {});

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `ambiguous_lifecycle`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `1`");
    expect(output).toContain(
      "**summary:** Multiple lifecycle records match the current context; 2 candidate(s) found.",
    );
  });

  it("lifecycle_finish omitted issue_number path emits invalid_issue_number ask_user recovery hint fields", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => {
        throw new Error("finish should not be called without issue_number");
      },
    });

    const output = await execute(tool, { merge_strategy: "auto", wait_for_checks: false });

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `invalid_issue_number`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `1`");
    expect(output).toContain(
      "**summary:** issue_number was omitted and no active lifecycle could be inferred. Pass issue_number explicitly or run lifecycle_current first.",
    );
  });

  it("lifecycle_resume stale-record failure path emits the required recovery hint fields", async () => {
    const tool = createLifecycleResumeTool({
      resume: async () => {
        throw new StaleRecordError({
          issueNumber: 67,
          branch: "issue/67-stale",
          worktree: "/tmp/issue-67-stale",
          state: "in_progress",
          stale: true,
          staleReason: "branch_merged",
        });
      },
      forceRefresh: async () => {
        throw new Error("force_refresh should not be called");
      },
    });

    const output = await execute(tool, { issue_number: 67 });

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `stale_record`");
    expect(output).toContain("**recommended_next_action:** `clean_stale_records`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `1`");
    expect(output).toContain("**summary:** branch_merged");
  });

  it("lifecycle_recovery_decision blocked path emits the required recovery hint fields", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => ({
        kind: "blocked",
        reason: "branch_mismatch",
        detail: "expected issue/67-active, found main",
        lastSeq: 4,
      }),
    });

    const output = await execute(tool, { issue_number: 67, owner: "session-a" });

    expectRecoveryHintShape(output);
    expect(output).toContain("**failure_kind:** `unknown`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**safe_to_retry:** `false`");
    expect(output).toContain("**attempt:** `1`");
    expect(output).toContain("**summary:** branch_mismatch: expected issue/67-active, found main");
  });
});
