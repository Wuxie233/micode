import { describe, expect, it } from "bun:test";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import type { ContextCapsuleFreshnessInput, ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

function frontmatter(overrides: Partial<ContextCapsuleFrontmatter> = {}): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: 91,
    branch: "issue-91-working-context-capsule",
    head_sha: "abc123",
    worktree: "/root/CODE/issue-91-working-context-capsule",
    created_at: "2026-05-17T00:00:00.000Z",
    source_files: ["src/agents/executor.ts", "src/agents/planner.ts"],
    source_hashes: {
      "src/agents/executor.ts": "executor-hash",
      "src/agents/planner.ts": "planner-hash",
    },
    ...overrides,
  };
}

function input(overrides: Partial<ContextCapsuleFreshnessInput> = {}): ContextCapsuleFreshnessInput {
  return {
    expectedLifecycleIssue: 91,
    branch: "issue-91-working-context-capsule",
    headSha: "abc123",
    worktree: "/root/CODE/issue-91-working-context-capsule",
    sourceHashes: {
      "src/agents/executor.ts": "executor-hash",
      "src/agents/planner.ts": "planner-hash",
    },
    frontmatter: frontmatter(),
    ...overrides,
  };
}

describe("context capsule freshness", () => {
  it("returns fresh for an exact lifecycle, branch, worktree, HEAD, and source hash match", () => {
    expect(evaluateContextCapsuleFreshness(input())).toEqual({
      status: "fresh",
      reasons: [],
      staleSourceFiles: [],
    });
  });

  it("returns partially-stale for HEAD and source hash drift with sorted stale source files", () => {
    expect(
      evaluateContextCapsuleFreshness(
        input({
          headSha: "def456",
          sourceHashes: {
            "src/agents/planner.ts": "new-planner-hash",
            "src/agents/executor.ts": "new-executor-hash",
          },
        }),
      ),
    ).toEqual({
      status: "partially-stale",
      reasons: ["head_sha_changed", "source_hashes_changed"],
      staleSourceFiles: ["src/agents/executor.ts", "src/agents/planner.ts"],
    });
  });

  it("hard-discards when the lifecycle issue does not match", () => {
    expect(evaluateContextCapsuleFreshness(input({ expectedLifecycleIssue: 92 }))).toEqual({
      status: "discarded",
      reasons: ["lifecycle_issue_mismatch"],
      staleSourceFiles: [],
    });
  });

  it("hard-discards when the branch does not match", () => {
    expect(evaluateContextCapsuleFreshness(input({ branch: "issue-92-other-work" }))).toEqual({
      status: "discarded",
      reasons: ["branch_mismatch"],
      staleSourceFiles: [],
    });
  });

  it("hard-discards when the worktree does not match", () => {
    expect(evaluateContextCapsuleFreshness(input({ worktree: "/root/CODE/issue-92-other-work" }))).toEqual({
      status: "discarded",
      reasons: ["worktree_mismatch"],
      staleSourceFiles: [],
    });
  });
});
