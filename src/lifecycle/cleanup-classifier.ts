/**
 * Pure classification of a worktree's cleanup eligibility.
 *
 * Inputs are raw observations gathered by cleanup-policy.ts (which owns shelling out).
 * Output is a discriminated union the policy uses to decide:
 *   - clean             -> safe to remove automatically (with one safe retry)
 *   - missing           -> already gone, mark removed without action
 *   - dirty             -> tracked changes present, NEVER force-delete
 *   - has-user-work     -> branch unmerged or issue still open, escalate
 *   - ambiguous         -> only untracked/generated files; surface for user decision
 *   - unknown-external  -> path is not registered as a git worktree, never auto-delete
 */
export type CleanupKind = "clean" | "missing" | "dirty" | "has-user-work" | "ambiguous" | "unknown-external";

export interface CleanupClassification {
  readonly kind: CleanupKind;
  readonly reason: string;
}

export interface CleanupQuery {
  /** True when the worktree directory exists on disk. */
  readonly worktreeExists: boolean;
  /** True when the branch has been merged into the resolved base branch. */
  readonly branchMerged: boolean;
  /** True when the lifecycle issue has been closed. */
  readonly issueClosed: boolean;
  /** Output of `git status --porcelain` from inside the worktree. */
  readonly workingTreeStatus: string;
  /** Untracked paths reported by `git ls-files --others --exclude-standard`. */
  readonly untrackedPaths: readonly string[];
  /** True when `git worktree list --porcelain` includes this path. */
  readonly worktreeIsRegistered: boolean;
  /** True when the path looks like an unrelated external clone (different remote, etc.). */
  readonly worktreeIsExternalClone: boolean;
}

const REASON = {
  CLEAN: "worktree merged, issue closed, working tree empty",
  MISSING: "worktree path does not exist on disk",
  EXTERNAL: "worktree is not registered with this repository",
  ISSUE_OPEN: "lifecycle issue is still open",
  BRANCH_UNMERGED: "branch has not been merged into base",
} as const;
const MAX_REASON_PATHS = 5;

const trackedDirtyPaths = (status: string): readonly string[] =>
  status
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^.. /, ""));

export function classifyCleanup(query: CleanupQuery): CleanupClassification {
  if (!query.worktreeExists) {
    return { kind: "missing", reason: REASON.MISSING };
  }

  if (!query.worktreeIsRegistered || query.worktreeIsExternalClone) {
    return { kind: "unknown-external", reason: REASON.EXTERNAL };
  }

  if (!query.issueClosed) {
    return { kind: "has-user-work", reason: REASON.ISSUE_OPEN };
  }

  if (!query.branchMerged) {
    return { kind: "has-user-work", reason: REASON.BRANCH_UNMERGED };
  }

  const dirty = trackedDirtyPaths(query.workingTreeStatus);
  if (dirty.length > 0) {
    return { kind: "dirty", reason: `tracked changes present: ${dirty.slice(0, MAX_REASON_PATHS).join(", ")}` };
  }

  if (query.untrackedPaths.length > 0) {
    return {
      kind: "ambiguous",
      reason: `untracked files present: ${query.untrackedPaths.slice(0, MAX_REASON_PATHS).join(", ")}`,
    };
  }

  return { kind: "clean", reason: REASON.CLEAN };
}
