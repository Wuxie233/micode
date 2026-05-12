import { describe, expect, it } from "bun:test";

import { COMMANDER_PROMPT } from "@/agents/commander";

describe("commander lifecycle recovery prompt", () => {
  it("documents bounded recovery loop", () => {
    expect(COMMANDER_PROMPT).toContain("bounded-recovery-loop");
    expect(COMMANDER_PROMPT).toContain("### Recovery hint");
  });

  it("forbids force push, --no-verify, reset --hard, auto-delete, and restart in recovery", () => {
    expect(COMMANDER_PROMPT).toContain("--force");
    expect(COMMANDER_PROMPT).toContain("--no-verify");
    expect(COMMANDER_PROMPT).toContain("reset --hard");
    expect(COMMANDER_PROMPT).toContain("NEVER delete user files");
    expect(COMMANDER_PROMPT).toContain("NEVER restart OpenCode as part of recovery");
  });

  it("handles ambiguous lifecycle via lifecycle_resume force_refresh of stale candidates", () => {
    expect(COMMANDER_PROMPT).toContain("ambiguous_lifecycle");
    expect(COMMANDER_PROMPT).toContain("lifecycle_resume(issue_number=N, force_refresh=true)");
  });

  it("maximum 3 recovery rounds", () => {
    expect(COMMANDER_PROMPT).toMatch(/(maximum|max) 3 recovery (round|attempt)/i);
  });

  it("maps each lifecycle recovery failure_kind to an action", () => {
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
      expect(COMMANDER_PROMPT).toContain(`kind="${kind}"`);
    }
  });
});
