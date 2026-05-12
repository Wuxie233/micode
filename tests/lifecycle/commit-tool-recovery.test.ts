import { describe, expect, it } from "bun:test";

import type { CommitOutcome, LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import { createLifecycleCommitTool } from "@/tools/lifecycle/commit";

const handle = (outcome: CommitOutcome | Error): Pick<LifecycleHandle, "commit"> => ({
  commit: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
});

const run = async (h: Pick<LifecycleHandle, "commit">) => {
  const tool = createLifecycleCommitTool(h);
  return tool.execute({ issue_number: 67, scope: "lifecycle", summary: "x", push: true }, {});
};

describe("lifecycle_commit tool header + recovery hint", () => {
  it("success: header is `Lifecycle commit recorded`", async () => {
    const md = await run(handle({ committed: true, sha: "abc", pushed: true, retried: false, note: null }));
    expect(md).toContain("## Lifecycle commit recorded");
    expect(md).not.toContain("### Recovery hint");
  });

  it("staging failure: header is `Lifecycle commit failed`, NOT `recorded`", async () => {
    const hint = buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "Staging failed" });
    const md = await run(
      handle({
        committed: false,
        sha: null,
        pushed: false,
        retried: false,
        note: "Staging failed",
        recoveryHint: hint,
      }),
    );
    expect(md).toContain("## Lifecycle commit failed");
    expect(md).not.toContain("## Lifecycle commit recorded");
    expect(md).toContain("### Recovery hint");
  });

  it("push failed but commit retained: header is `Push failed (commit retained locally)`", async () => {
    const hint = buildHint({
      failureKind: "push_failed",
      recommendedNextAction: "retry_finish",
      summary: "net err",
      safeToRetry: true,
    });
    const md = await run(
      handle({ committed: true, sha: "abc", pushed: false, retried: true, note: "Push failed", recoveryHint: hint }),
    );
    expect(md).toContain("## Push failed (commit retained locally)");
    expect(md).toContain("**safe_to_retry:** `true`");
  });

  it("push failure hint marks retained commit as push failed even without retry", async () => {
    const hint = buildHint({
      failureKind: "push_failed",
      recommendedNextAction: "retry_finish",
      summary: "push rejected before retry",
      safeToRetry: true,
    });
    const md = await run(
      handle({ committed: true, sha: "abc", pushed: false, retried: false, note: "Push failed", recoveryHint: hint }),
    );
    expect(md).toContain("## Push failed (commit retained locally)");
    expect(md).toContain("push rejected before retry");
  });

  it("nothing-to-commit: header is `Nothing to commit`, no hint", async () => {
    const md = await run(handle({ committed: false, sha: null, pushed: false, retried: false, note: null }));
    expect(md).toContain("## Nothing to commit");
    expect(md).not.toContain("### Recovery hint");
  });

  it("exception: header is `Lifecycle commit failed`, contains hint", async () => {
    const md = await run(handle(new Error("explode")));
    expect(md).toContain("## Lifecycle commit failed");
    expect(md).toContain("### Recovery hint");
  });
});
