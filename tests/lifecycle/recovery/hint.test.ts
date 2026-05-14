import { describe, expect, it } from "bun:test";

import {
  buildHint,
  isSafeToRetry,
  LIFECYCLE_FAILURE_KINDS,
  LIFECYCLE_RECOMMENDED_ACTIONS,
  type LifecycleRecoveryHint,
} from "@/lifecycle/recovery/hint";

describe("LifecycleRecoveryHint", () => {
  it("exposes the 10 failure kinds named in the design", () => {
    expect(LIFECYCLE_FAILURE_KINDS).toEqual([
      "ambiguous_lifecycle",
      "stale_record",
      "record_missing",
      "invalid_issue_number",
      "dirty_base_worktree",
      "merge_conflict",
      "untracked_cleanup_blocker",
      "tracked_cleanup_blocker",
      "pr_checks_failed",
      "push_failed",
      "unknown",
    ]);
  });

  it("exposes the 7 recommended actions named in the design", () => {
    expect(LIFECYCLE_RECOMMENDED_ACTIONS).toEqual([
      "resume_issue",
      "clean_stale_records",
      "retry_finish",
      "use_temp_merge_worktree",
      "resolve_conflicts",
      "quarantine_artifacts",
      "ask_user",
    ]);
  });

  it("buildHint produces a frozen, valid hint with sensible defaults", () => {
    const hint = buildHint({
      failureKind: "ambiguous_lifecycle",
      recommendedNextAction: "ask_user",
      summary: "multiple open lifecycles",
    });
    expect(hint.failureKind).toBe("ambiguous_lifecycle");
    expect(hint.safeToRetry).toBe(false);
    expect(hint.attempt).toBe(1);
    expect(Object.isFrozen(hint)).toBe(true);
  });

  it("isSafeToRetry returns false for unknown / ask_user combos", () => {
    const hint: LifecycleRecoveryHint = buildHint({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      summary: "n/a",
    });
    expect(isSafeToRetry(hint)).toBe(false);
  });

  it("isSafeToRetry returns true when safeToRetry flag is set", () => {
    const hint: LifecycleRecoveryHint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "conflict in src/foo.ts",
      safeToRetry: true,
    });
    expect(isSafeToRetry(hint)).toBe(true);
  });
});
