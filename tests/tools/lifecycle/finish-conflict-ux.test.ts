import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { FinishOutcome, LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";

const TOOL_CONTEXT = {} as unknown as ToolContext;

const stringify = (outcome: ToolResult): string => (typeof outcome === "string" ? outcome : outcome.output);

const executeFinish = async (outcome: FinishOutcome): Promise<string> => {
  const handle: Pick<LifecycleHandle, "finish"> = { finish: async () => outcome };
  const tool = createLifecycleFinishTool(handle);
  const exec = tool.execute.bind(tool) as unknown as (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;
  return stringify(await exec({ issue_number: 85, merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT));
};

describe("lifecycle_finish conflict UX", () => {
  it("keeps tool output parseable while adding compact conflict summary", async () => {
    const md = await executeFinish({
      merged: false,
      prUrl: null,
      closedAt: null,
      worktreeRemoved: false,
      cleanupOutcome: { kind: "failed", reason: "cleanup not attempted", retried: false },
      note: "merge_conflict",
      recoveryHint: buildHint({
        failureKind: "merge_conflict",
        recommendedNextAction: "resolve_conflicts",
        summary: "merge conflicts in 1 file",
        issueNumber: 85,
        branch: "issue/85-x",
        worktree: "/tmp/micode-merge-issue-85",
        conflictFiles: ["src/lifecycle/merge.ts"],
      }),
    });

    expect(md).toContain("## Lifecycle finish failed");
    expect(md).toContain("### Conflict resolver context");
    expect(md).toContain("resolver may edit conflict files plus directly related tests/types/call sites");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `merge_conflict`");
  });
});
