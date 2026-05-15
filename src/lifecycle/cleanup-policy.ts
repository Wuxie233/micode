import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { type CleanupClassification, classifyCleanup } from "./cleanup-classifier";
import { classifyQuarantine, type QuarantineClassification } from "./recovery/quarantine-classifier";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CleanupOutcome } from "./types";

export interface CleanupFsOps {
  readonly mkdir: (path: string) => void;
  readonly rename: (from: string, to: string) => void;
}

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
  /** Lifecycle issue number used to place quarantine backups. */
  readonly issueNumber: number;
  /** Known lifecycle artifact pointers that are safe to quarantine if untracked. */
  readonly artifactPointers: readonly string[];
  /** Optional clock override for deterministic backup directory names in tests. */
  readonly now?: () => Date;
  /** Optional filesystem adapter; defaults to mkdirSync(recursive) + renameSync. */
  readonly fsOps?: CleanupFsOps;
  /**
   * Optional override for filesystem existence check. When omitted the policy
   * uses node:fs `existsSync(worktree)`. Tests inject this to avoid touching disk.
   */
  readonly worktreeExistsOnDisk?: boolean;
  /** Optional branch cleanup after successful worktree cleanup; defaults to false. */
  readonly cleanupBranch?: boolean;
}

const OK = 0;
const ALREADY_MISSING_KIND = "already-missing";
const WORKTREE_LIST_PORCELAIN_ARGS = ["worktree", "list", "--porcelain"] as const;
const completed = (run: RunResult): boolean => run.exitCode === OK;

const defaultFsOps: CleanupFsOps = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  rename: (from, to) => renameSync(from, to),
};

const splitLines = (s: string): readonly string[] =>
  s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const isWorktreeRegistered = (listOutput: string, worktreePath: string): boolean => {
  // `git worktree list --porcelain` emits stanzas starting with `worktree <path>`.
  return splitLines(listOutput).some((line) => line === `worktree ${worktreePath}`);
};

const isStandardLifecycleBranch = (branch: string): boolean => /^issue\/\d+-[^\s/]+$/.test(branch);

const isBranchCheckedOutInAnyWorktree = (listOutput: string, branch: string): boolean => {
  const branchRef = `branch refs/heads/${branch}`;
  return splitLines(listOutput).some((line) => line === branchRef);
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
      return { kind: ALREADY_MISSING_KIND, reason: classification.reason, retried: false };
    case "clean":
      // Should not reach here; clean is handled before blocked().
      return { kind: "failed", reason: "internal: clean classification routed to blocked()", retried: false };
  }
};

const blockedAmbiguous = (reason: string): CleanupOutcome => ({
  kind: "blocked-ambiguous",
  reason,
  retried: false,
});

const formatRunFailure = (run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((p) => p.length > 0);
  if (pieces.length === 0) return `exit ${run.exitCode}`;
  return pieces.join(" ");
};

const appendReason = (outcome: CleanupOutcome, suffix: string): CleanupOutcome => ({
  ...outcome,
  reason: `${outcome.reason}; ${suffix}`,
});

const cleanupBranchAfterWorktree = async (
  runner: LifecycleRunner,
  input: CleanupPolicyInput,
  outcome: CleanupOutcome,
): Promise<CleanupOutcome> => {
  if (input.cleanupBranch !== true) return outcome;
  if (outcome.kind !== "removed" && outcome.kind !== ALREADY_MISSING_KIND) return outcome;

  if (!isStandardLifecycleBranch(input.branch)) {
    return appendReason(outcome, `branch cleanup skipped: non-lifecycle branch ${input.branch}`);
  }

  const list = await runner.git(WORKTREE_LIST_PORCELAIN_ARGS, { cwd: input.cwd });
  if (!completed(list)) {
    return failed(
      `worktree removal succeeded but branch cleanup failed: git_worktree_list: ${formatRunFailure(list)}`,
      outcome.retried,
    );
  }

  if (isBranchCheckedOutInAnyWorktree(list.stdout, input.branch)) {
    return appendReason(
      outcome,
      `branch cleanup skipped: branch ${input.branch} is checked out in a registered worktree`,
    );
  }

  const branchDelete = await runner.git(["branch", "-d", input.branch], { cwd: input.cwd });
  if (completed(branchDelete)) {
    return appendReason(outcome, `deleted branch ${input.branch}`);
  }

  return failed(
    `worktree removal succeeded but branch cleanup failed: git_branch_delete: ${formatRunFailure(branchDelete)}`,
    outcome.retried,
  );
};

const buildBackupBase = (cwd: string, issueNumber: number, timestamp: Date): string =>
  join(cwd, "thoughts", "lifecycle", "backups", `issue-${issueNumber}`, timestamp.toISOString().replace(/[:.]/g, "-"));

const quarantineUntracked = (
  cwd: string,
  worktree: string,
  paths: readonly string[],
  artifactPointers: readonly string[],
  issueNumber: number,
  timestamp: Date,
  fsOps: CleanupFsOps,
):
  | { readonly kind: "ok"; readonly backupBase: string; readonly count: number }
  | { readonly kind: "blocked"; readonly reason: string } => {
  const decisions: readonly QuarantineClassification[] = paths.map((path) =>
    classifyQuarantine({ untrackedPath: path, artifactPointers }),
  );
  const blockedDecision = decisions.find((decision) => decision.kind === "block");
  if (blockedDecision !== undefined) return { kind: "blocked", reason: blockedDecision.reason };

  const backupBase = buildBackupBase(cwd, issueNumber, timestamp);
  for (const rel of paths) {
    const from = join(worktree, rel);
    const to = join(backupBase, rel);
    fsOps.mkdir(dirname(to));
    fsOps.rename(from, to);
  }

  return { kind: "ok", backupBase, count: paths.length };
};

const removeWorktree = async (
  runner: LifecycleRunner,
  input: CleanupPolicyInput,
  reason: string,
): Promise<CleanupOutcome> => {
  const firstAttempt = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(firstAttempt)) {
    return cleanupBranchAfterWorktree(runner, input, removed(reason, false));
  }

  // Safe retry: prune stale registrations once, then retry remove exactly once.
  await runner.git(["worktree", "prune"], { cwd: input.cwd });
  const retry = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(retry)) {
    return cleanupBranchAfterWorktree(runner, input, removed(reason, true));
  }

  return failed(`git_worktree_remove: ${formatRunFailure(retry)}`, true);
};

const handleAmbiguousCleanup = async (
  runner: LifecycleRunner,
  input: CleanupPolicyInput,
  untrackedPaths: readonly string[],
): Promise<CleanupOutcome> => {
  const quarantine = quarantineUntracked(
    input.cwd,
    input.worktree,
    untrackedPaths,
    input.artifactPointers,
    input.issueNumber,
    (input.now ?? (() => new Date()))(),
    input.fsOps ?? defaultFsOps,
  );
  if (quarantine.kind === "blocked") return blockedAmbiguous(`quarantine_blocked: ${quarantine.reason}`);

  return removeWorktree(runner, input, `quarantined ${quarantine.count} files to ${quarantine.backupBase}`);
};

export async function runCleanup(runner: LifecycleRunner, input: CleanupPolicyInput): Promise<CleanupOutcome> {
  const exists = input.worktreeExistsOnDisk ?? existsSync(input.worktree);
  if (!exists) {
    return cleanupBranchAfterWorktree(runner, input, {
      kind: ALREADY_MISSING_KIND,
      reason: "worktree path does not exist on disk",
      retried: false,
    });
  }

  const list = await runner.git(WORKTREE_LIST_PORCELAIN_ARGS, { cwd: input.cwd });
  const isRegistered = completed(list) && isWorktreeRegistered(list.stdout, input.worktree);

  const status = await runner.git(["status", "--porcelain"], { cwd: input.worktree });
  const untracked = await runner.git(["ls-files", "--others", "--exclude-standard"], { cwd: input.worktree });

  const untrackedPaths = completed(untracked) ? splitLines(untracked.stdout) : [];
  const classification = classifyCleanup({
    worktreeExists: true,
    branchMerged: input.branchMerged,
    issueClosed: input.issueClosed,
    workingTreeStatus: completed(status) ? filterUntrackedStatus(status.stdout) : "",
    untrackedPaths,
    worktreeIsRegistered: isRegistered,
    worktreeIsExternalClone: !isRegistered,
  });

  if (classification.kind !== "clean") {
    if (classification.kind === "ambiguous") return handleAmbiguousCleanup(runner, input, untrackedPaths);
    return blocked(classification);
  }

  return removeWorktree(runner, input, classification.reason);
}
