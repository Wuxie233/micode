import { describe, expect, it } from "bun:test";

import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint, RECOVERY_SECTION_HEADER } from "@/lifecycle/recovery/hint-format";

describe("formatRecoveryHint", () => {
  it("renders the stable section header", () => {
    const md = formatRecoveryHint(
      buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "boom" }),
    );
    expect(md.startsWith(RECOVERY_SECTION_HEADER)).toBe(true);
  });

  it("includes failure_kind, recommended_next_action, safe_to_retry, attempt", () => {
    const md = formatRecoveryHint(
      buildHint({
        failureKind: "merge_conflict",
        recommendedNextAction: "resolve_conflicts",
        summary: "two conflicts",
        safeToRetry: true,
        attempt: 2,
        issueNumber: 67,
        branch: "issue/67-foo",
        worktree: "/tmp/m",
        conflictFiles: ["a.ts", "b.ts"],
      }),
    );
    expect(md).toContain("**failure_kind:** `merge_conflict`");
    expect(md).toContain("**recommended_next_action:** `resolve_conflicts`");
    expect(md).toContain("**safe_to_retry:** `true`");
    expect(md).toContain("**attempt:** `2`");
    expect(md).toContain("**issue_number:** `67`");
    expect(md).toContain("- `a.ts`");
    expect(md).toContain("- `b.ts`");
  });

  it("omits empty candidate / conflict_files / backup_path sections", () => {
    const md = formatRecoveryHint(
      buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "x" }),
    );
    expect(md).not.toContain("**candidates:**");
    expect(md).not.toContain("**conflict_files:**");
    expect(md).not.toContain("**backup_path:**");
  });

  it("renders candidates with stale flag", () => {
    const md = formatRecoveryHint(
      buildHint({
        failureKind: "ambiguous_lifecycle",
        recommendedNextAction: "clean_stale_records",
        summary: "12 candidates",
        candidates: [
          {
            issueNumber: 7,
            branch: "issue/7-a",
            worktree: null,
            state: "branch_ready",
            stale: true,
            staleReason: "issue closed on github",
          },
          {
            issueNumber: 67,
            branch: "issue/67-b",
            worktree: "/wt",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    );
    expect(md).toContain("| 7 | `issue/7-a` | `-` | `branch_ready` | `true` | issue closed on github |");
    expect(md).toContain("| 67 | `issue/67-b` | `/wt` | `in_progress` | `false` | - |");
  });
});
