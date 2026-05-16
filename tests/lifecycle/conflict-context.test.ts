import { describe, expect, it } from "bun:test";

import {
  buildConflictResolverContext,
  CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
  isDirectlyRelatedResolverPath,
} from "@/lifecycle/conflict-context";
import { buildHint } from "@/lifecycle/recovery/hint";

describe("conflict resolver context", () => {
  it("builds a minimal resolver context from a merge_conflict recovery hint", () => {
    const hint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "2 conflicts",
      issueNumber: 85,
      branch: "issue/85-lifecycle-conflict-resolver-response-ux",
      worktree: "/tmp/micode-merge-issue-85",
      conflictFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
    });

    const context = buildConflictResolverContext(hint, { baseBranch: "main" });

    expect(context).toEqual({
      issueNumber: 85,
      branch: "issue/85-lifecycle-conflict-resolver-response-ux",
      baseBranch: "main",
      tempWorktree: "/tmp/micode-merge-issue-85",
      conflictFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
      allowedFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
      allowedExpansionKinds: ["test", "type", "call-site"],
      forbiddenOperations: CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
      requiresSemanticQuestion: true,
      maxValidationRepairRounds: 2,
    });
  });

  it("rejects non merge_conflict hints and incomplete hints", () => {
    expect(() =>
      buildConflictResolverContext(
        buildHint({ failureKind: "push_failed", recommendedNextAction: "retry_finish", summary: "push" }),
      ),
    ).toThrow(/merge_conflict/);
    expect(() =>
      buildConflictResolverContext(
        buildHint({ failureKind: "merge_conflict", recommendedNextAction: "resolve_conflicts", summary: "missing" }),
      ),
    ).toThrow(/worktree.*conflict_files.*issue_number/i);
  });

  it("classifies only small directly-related expansion paths as allowed candidates", () => {
    const conflictFiles = ["src/lifecycle/merge.ts"];

    expect(isDirectlyRelatedResolverPath("tests/lifecycle/merge.test.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/lifecycle/types.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/lifecycle/index.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/agents/commander.ts", conflictFiles)).toBe(false);
    expect(isDirectlyRelatedResolverPath("package.json", conflictFiles)).toBe(false);
  });
});
