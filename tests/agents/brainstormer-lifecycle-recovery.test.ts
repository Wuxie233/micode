import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";

describe("brainstormer lifecycle recovery prompt", () => {
  it("does NOT contain the legacy single-attempt halt rule", () => {
    expect(BRAINSTORMER_PROMPT).not.toContain("Single attempt per call. Do not retry on failure");
    expect(BRAINSTORMER_PROMPT).not.toContain("invocation with no retry");
    expect(BRAINSTORMER_PROMPT).not.toContain("If a tool reports failure, surface it to the user and halt");
  });

  it("contains the bounded-recovery-loop block", () => {
    expect(BRAINSTORMER_PROMPT).toContain("<bounded-recovery-loop");
    expect(BRAINSTORMER_PROMPT).toContain("Maximum 3 recovery rounds");
  });

  it("explicitly forbids force push, --no-verify, reset --hard during recovery", () => {
    expect(BRAINSTORMER_PROMPT).toContain("--force");
    expect(BRAINSTORMER_PROMPT).toContain("--no-verify");
    expect(BRAINSTORMER_PROMPT).toContain("reset --hard");
  });

  it("explicitly forbids restarting OpenCode during recovery", () => {
    expect(BRAINSTORMER_PROMPT).toContain("NEVER restart OpenCode as part of recovery");
  });

  it("maps each failure_kind to an action", () => {
    for (const kind of [
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
    ]) {
      expect(BRAINSTORMER_PROMPT).toContain(`kind="${kind}"`);
    }
  });
});
