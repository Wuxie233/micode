import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const AGENTS_MD = readFileSync("AGENTS.md", "utf8");

describe("AGENTS.md lifecycle recovery mirror", () => {
  it("contains the Autonomous Lifecycle Recovery section", () => {
    expect(AGENTS_MD).toContain("## Autonomous Lifecycle Recovery");
  });

  it("lists all 11 failure_kind values", () => {
    for (const k of [
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
      expect(AGENTS_MD).toContain(k);
    }
  });

  it("lists all 7 recommended_next_action values", () => {
    for (const a of [
      "resume_issue",
      "clean_stale_records",
      "retry_finish",
      "use_temp_merge_worktree",
      "resolve_conflicts",
      "quarantine_artifacts",
      "ask_user",
    ]) {
      expect(AGENTS_MD).toContain(a);
    }
  });

  it("states the hard safety rules verbatim", () => {
    expect(AGENTS_MD).toContain("no force push");
    expect(AGENTS_MD).toContain("--no-verify");
    expect(AGENTS_MD).toContain("reset --hard");
    expect(AGENTS_MD).toContain("auto-restart");
  });

  it("points to the prompt single-source via drift guard", () => {
    expect(AGENTS_MD).toMatch(/Drift guard.*brainstormer\.ts/);
  });
});
