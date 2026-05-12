import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import type { FinishOutcome, LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";

const TOOL_CONTEXT = {} as unknown as ToolContext;

const fakeHandle = (outcome: FinishOutcome | Error): Pick<LifecycleHandle, "finish"> => ({
  finish: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
});

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const executeFinish = async (handle: Pick<LifecycleHandle, "finish">): Promise<string> => {
  const tool = createLifecycleFinishTool(handle);
  const exec = tool.execute.bind(tool) as unknown as ExecuteSignature;
  return stringify(await exec({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT));
};

describe("lifecycle_finish tool recovery hint", () => {
  it("success outcome contains no `### Recovery hint` section", async () => {
    const md = await executeFinish(
      fakeHandle({
        merged: true,
        prUrl: null,
        closedAt: Date.now(),
        worktreeRemoved: true,
        cleanupOutcome: { kind: "removed", reason: "x", retried: false },
        note: null,
      }),
    );
    expect(md).not.toContain("### Recovery hint");
  });

  it("merge_conflict outcome contains recovery hint with conflict_files and worktree", async () => {
    const hint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "2 conflicts",
      issueNumber: 67,
      worktree: "/tmp/m",
      conflictFiles: ["a.ts", "b.ts"],
    });
    const md = await executeFinish(
      fakeHandle({
        merged: false,
        prUrl: null,
        closedAt: null,
        worktreeRemoved: false,
        cleanupOutcome: { kind: "failed", reason: "n/a", retried: false },
        note: "merge_conflict",
        recoveryHint: hint,
      }),
    );
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `merge_conflict`");
    expect(md).toContain("**worktree:** `/tmp/m`");
    expect(md).toContain("- `a.ts`");
    expect(md).toContain("- `b.ts`");
  });

  it("exception path emits unknown hint with summary=error message", async () => {
    const md = await executeFinish(fakeHandle(new Error("boom")));
    expect(md).toContain("## Lifecycle finish failed");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `unknown`");
    expect(md).toContain("**recommended_next_action:** `ask_user`");
    expect(md).toContain("**issue_number:** `67`");
    expect(md).toContain("boom");
  });
});
