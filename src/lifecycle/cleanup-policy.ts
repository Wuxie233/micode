import { existsSync } from "node:fs";

import { type CleanupClassification, classifyCleanup } from "./cleanup-classifier";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CleanupOutcome } from "./types";

export interface CleanupPolicyInput {
  /** Repository root (where lifecycle was started). */
  readonly cwd: string;
  /** Lifecycle worktree path to clean up. */
  readonly worktree: string;
  /** Branch name associated with the worktree. */
  readonly branch: string;
  /** Resolved default branch (used to confirm merge state). */
  readonly baseBranch: string;
  /** Caller-provided: true when the lifecycle issue is already closed. */
  readonly issueClosed: boolean;
  /** Caller-provided: true when `branch` has been merged into `baseBranch`. */
  readonly branchMerged: boolean;
  /**
   * Optional override for filesystem existence check. When omitted the policy
   * uses node:fs `existsSync(worktree)`. Tests inject this to avoid touching disk.
   */
  readonly worktreeExistsOnDisk?: boolean;
}

const OK = 0;
const completed = (run: RunResult): boolean => run.exitCode === OK;

const splitLines = (s: string): readonly string[] =>
  s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const isWorktreeRegistered = (listOutput: string, worktreePath: string): boolean => {
  // `git worktree list --porcelain` emits stanzas starting with `worktree <path>`.
  return splitLines(listOutput).some((line) => line === `worktree ${worktreePath}`);
};

const filterUntrackedStatus = (status: string): string =>
  status
    .split("\n")
    .filter((line) => !line.startsWith("?? "))
    .join("\n");

const removed = (reason: string, retried: boolean): CleanupOutcome => ({
  kind: "removed",
  reason,
  retried,
});

const failed = (reason: string, retried: boolean): CleanupOutcome => ({
  kind: "failed",
  reason,
  retried,
});

const blocked = (classification: CleanupClassification): CleanupOutcome => {
  switch (classification.kind) {
    case "dirty":
      return { kind: "blocked-dirty", reason: classification.reason, retried: false };
    case "has-user-work":
      return { kind: "blocked-user-work", reason: classification.reason, retried: false };
    case "ambiguous":
      return { kind: "blocked-ambiguous", reason: classification.reason, retried: false };
    case "unknown-external":
      return { kind: "blocked-external", reason: classification.reason, retried: false };
    case "missing":
      return { kind: "already-missing", reason: classification.reason, retried: false };
    case "clean":
      // Should not reach here; clean is handled before blocked().
      return { kind: "failed", reason: "internal: clean classification routed to blocked()", retried: false };
  }
};

const formatRunFailure = (run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((p) => p.length > 0);
  if (pieces.length === 0) return `exit ${run.exitCode}`;
  return pieces.join(" ");
};

export async function runCleanup(runner: LifecycleRunner, input: CleanupPolicyInput): Promise<CleanupOutcome> {
  const exists = input.worktreeExistsOnDisk ?? existsSync(input.worktree);
  if (!exists) {
    return { kind: "already-missing", reason: "worktree path does not exist on disk", retried: false };
  }

  const list = await runner.git(["worktree", "list", "--porcelain"], { cwd: input.cwd });
  const isRegistered = completed(list) && isWorktreeRegistered(list.stdout, input.worktree);

  const status = await runner.git(["status", "--porcelain"], { cwd: input.worktree });
  const untracked = await runner.git(["ls-files", "--others", "--exclude-standard"], { cwd: input.worktree });

  const classification = classifyCleanup({
    worktreeExists: true,
    branchMerged: input.branchMerged,
    issueClosed: input.issueClosed,
    workingTreeStatus: completed(status) ? filterUntrackedStatus(status.stdout) : "",
    untrackedPaths: completed(untracked) ? splitLines(untracked.stdout) : [],
    worktreeIsRegistered: isRegistered,
    worktreeIsExternalClone: !isRegistered,
  });

  if (classification.kind !== "clean") {
    return blocked(classification);
  }

  const firstAttempt = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(firstAttempt)) {
    return removed(classification.reason, false);
  }

  // Safe retry: prune stale registrations once, then retry remove exactly once.
  await runner.git(["worktree", "prune"], { cwd: input.cwd });
  const retry = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(retry)) {
    return removed(classification.reason, true);
  }

  return failed(`git_worktree_remove: ${formatRunFailure(retry)}`, true);
}
