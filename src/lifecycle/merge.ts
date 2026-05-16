import { tmpdir } from "node:os";

import * as v from "valibot";

import { config } from "@/utils/config";
import type { CleanupFsOps } from "./cleanup-policy";
import { runCleanup } from "./cleanup-policy";
import { type ConflictResolverScopeResult, evaluateConflictResolverScope } from "./conflict-scope";
import { postOnceSummaryComment, upsertPullRequest, writeReviewSummaryToPrBody } from "./pr";
import { buildHint, type LifecycleRecoveryHint } from "./recovery/hint";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "./recovery/temp-worktree";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CleanupOutcome, FinishInput, FinishOutcome } from "./types";

export const PR_CHECK_POLL_MS = 30_000;

export interface FinishLifecycleInput {
  readonly cwd: string;
  readonly branch: string;
  readonly worktree: string;
  readonly mergeStrategy?: FinishInput["mergeStrategy"] | "auto";
  readonly waitForChecks: boolean;
  readonly baseBranch?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly reviewSummarySection?: string;
  readonly postSummaryComment?: boolean;
  readonly issueNumber?: number;
  readonly artifactPointers?: readonly string[];
  readonly fsOps?: CleanupFsOps;
}

const MERGE_STRATEGY = {
  AUTO: "auto",
  PR: "pr",
  LOCAL: "local-merge",
} as const;

const CHECK_OUTCOME = {
  SUCCESS: "success",
  FAILED: "failed",
  PENDING: "pending",
} as const;

const CHECK_STATE = {
  SUCCESS: "SUCCESS",
  SKIPPED: "SKIPPED",
  FAILURE: "FAILURE",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
  TIMED_OUT: "TIMED_OUT",
  ACTION_REQUIRED: "ACTION_REQUIRED",
} as const;

const OK_EXIT_CODE = 0;
const BASE_BRANCH_REQUIRED = "base branch not resolved";
const PR_CHECKS_FAILED = "pr_checks_failed";
const PR_BODY_DISAPPEARED_NOTE = "pr_body_update_failed: pr disappeared";
const CHECK_TIMEOUT_DETAIL = "timeout";
const OUTPUT_SEPARATOR = " ";
const DETAIL_SEPARATOR = ": ";
const CHECK_SEPARATOR = ", ";
const NOTE_SEPARATOR = "; ";

const GH_PR = "pr";
const GH_CHECKS = "checks";
const GH_MERGE = "merge";
const GH_REQUIRED_FLAG = "--required";
const GH_JSON_FLAG = "--json";
const GH_CHECK_FIELDS = "state,name";
const GH_SQUASH_FLAG = "--squash";

const GIT_MERGE = "merge";
const GIT_NO_FF_FLAG = "--no-ff";
const GIT_PUSH = "push";
const GIT_DIFF = "diff";
const GIT_NAME_ONLY = "--name-only";
const GIT_UNMERGED_FILTER = "--diff-filter=U";
const GIT_COMMIT = "commit";
const GIT_MESSAGE_FLAG = "-m";
const RESOLVED_CONFLICT_COMMIT_PREFIX = "merge";
const GIT_ORIGIN = "origin";
const GIT_BRANCH = "branch";
const GIT_DELETE_FLAG = "-d";
const GIT_STATUS = "status";
const GIT_PORCELAIN_FLAG = "--porcelain";
const TMP_DIR = tmpdir();
const ISSUE_BRANCH_RE = /^issue\/(\d+)-/;
const GIT_STATUS_PATH_OFFSET = 3;
const STATUS_RENAME_SEPARATOR = " -> ";

const CLEANUP_BLOCK_PREFIX = "cleanup_blocked";
const CLEANUP_FAIL_PREFIX = "cleanup_failed";

const CheckSchema = v.object({
  name: v.string(),
  state: v.string(),
});
const ChecksSchema = v.array(CheckSchema);

type Check = v.InferOutput<typeof CheckSchema>;
type ResolvedStrategy = typeof MERGE_STRATEGY.PR | typeof MERGE_STRATEGY.LOCAL;
type CheckOutcome =
  | { readonly status: typeof CHECK_OUTCOME.SUCCESS }
  | { readonly status: typeof CHECK_OUTCOME.FAILED; readonly note: string }
  | { readonly status: typeof CHECK_OUTCOME.PENDING };

interface InjectOutcome {
  readonly ok: boolean;
  readonly prUrl: string;
  readonly note: string | null;
}

interface ExistingTempMergeWorktree {
  readonly kind: "existing";
  readonly path: string;
  readonly modifiedFiles: readonly string[];
  readonly unmergedFiles: readonly string[];
}

type PreparedTempMergeWorktree =
  | { readonly kind: "created"; readonly path: string }
  | ExistingTempMergeWorktree
  | { readonly kind: "failed"; readonly outcome: FinishOutcome };

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const deriveIssueNumber = (branch: string): number | null => {
  const match = ISSUE_BRANCH_RE.exec(branch);
  const raw = match?.[1];
  if (!raw) return null;
  const issueNumber = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return null;
  return issueNumber;
};

const getBaseBranch = (input: FinishLifecycleInput): string => {
  if (input.baseBranch === undefined || input.baseBranch.length === 0) {
    throw new Error(`${BASE_BRANCH_REQUIRED} for issue branch ${input.branch}`);
  }
  return input.baseBranch;
};

const cleanupNote = (outcome: CleanupOutcome): string | null => {
  if (outcome.kind === "removed" || outcome.kind === "already-missing") return null;
  if (outcome.kind === "failed") return `${CLEANUP_FAIL_PREFIX}: ${outcome.reason}`;
  return `${CLEANUP_BLOCK_PREFIX}(${outcome.kind}): ${outcome.reason}`;
};

const worktreeRemovedFromCleanup = (outcome: CleanupOutcome): boolean =>
  outcome.kind === "removed" || outcome.kind === "already-missing";

const createOutcome = (
  merged: boolean,
  prUrl: string | null,
  cleanupOutcome: CleanupOutcome,
  note: string | null,
): FinishOutcome => ({
  merged,
  prUrl,
  closedAt: null,
  worktreeRemoved: worktreeRemovedFromCleanup(cleanupOutcome),
  cleanupOutcome,
  note,
});

const NOT_ATTEMPTED: CleanupOutcome = {
  kind: "failed",
  reason: "cleanup not attempted (merge did not complete)",
  retried: false,
};

const createPreCleanupOutcome = (merged: boolean, prUrl: string | null, note: string | null): FinishOutcome =>
  createOutcome(merged, prUrl, NOT_ATTEMPTED, note);

const withHint = (outcome: FinishOutcome, hint: LifecycleRecoveryHint): FinishOutcome => ({
  ...outcome,
  recoveryHint: hint,
});

const unknownHint = (issueNumber: number, branch: string, detail: string, worktree: string): LifecycleRecoveryHint =>
  buildHint({
    failureKind: "unknown",
    recommendedNextAction: "ask_user",
    summary: detail,
    issueNumber,
    branch,
    worktree,
    safeToRetry: false,
  });

const mergeNotes = (...notes: readonly (string | null | undefined)[]): string | null => {
  const present = notes.filter((note): note is string => note !== undefined && note !== null && note.length > 0);
  if (present.length === 0) return null;
  return present.join(NOTE_SEPARATOR);
};

const createPrChecksNote = (detail: string): string => `${PR_CHECKS_FAILED}${DETAIL_SEPARATOR}${detail}`;

const formatCommandFailure = (label: string, run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length > 0) return `${label}${DETAIL_SEPARATOR}${pieces.join(OUTPUT_SEPARATOR)}`;
  return `${label}${DETAIL_SEPARATOR}exit code ${run.exitCode}`;
};

const createCheckArgs = (branch: string): readonly string[] => [
  GH_PR,
  GH_CHECKS,
  branch,
  GH_REQUIRED_FLAG,
  GH_JSON_FLAG,
  GH_CHECK_FIELDS,
];

const parseChecks = (stdout: string): readonly Check[] | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(ChecksSchema, raw);
    if (parsed.success) return parsed.output;
    return null;
  } catch {
    // GitHub CLI can print prose instead of JSON when required checks are unavailable.
    return null;
  }
};

const isFailureState = (state: string): boolean => {
  return [
    CHECK_STATE.FAILURE,
    CHECK_STATE.ERROR,
    CHECK_STATE.CANCELLED,
    CHECK_STATE.TIMED_OUT,
    CHECK_STATE.ACTION_REQUIRED,
  ].some((candidate) => candidate === state);
};

const isSuccessState = (state: string): boolean => state === CHECK_STATE.SUCCESS || state === CHECK_STATE.SKIPPED;

const formatCheck = (check: Check): string => `${check.name}=${check.state}`;

const evaluateChecks = (run: RunResult): CheckOutcome => {
  if (!completed(run))
    return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote(formatCommandFailure(GH_CHECKS, run)) };

  const checks = parseChecks(run.stdout);
  if (!checks) return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote("invalid checks output") };

  const failures = checks.filter((check) => isFailureState(check.state));
  if (failures.length > 0)
    return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote(failures.map(formatCheck).join(CHECK_SEPARATOR)) };
  if (checks.length > 0 && checks.every((check) => isSuccessState(check.state)))
    return { status: CHECK_OUTCOME.SUCCESS };
  return { status: CHECK_OUTCOME.PENDING };
};

const sleepFor = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

const getCheckAttempts = (): number => Math.max(1, Math.ceil(config.lifecycle.prCheckTimeoutMs / PR_CHECK_POLL_MS) + 1);

const hasRemoteCi = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<boolean> => {
  const inspected = await runner.gh(createCheckArgs(input.branch), { cwd: input.cwd });
  if (!completed(inspected)) return false;

  const checks = parseChecks(inspected.stdout);
  return checks !== null && checks.length > 0;
};

const resolveStrategy = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<ResolvedStrategy> => {
  const requested = input.mergeStrategy ?? config.lifecycle.mergeStrategy;
  if (requested !== MERGE_STRATEGY.AUTO) return requested;
  if (await hasRemoteCi(runner, input)) return MERGE_STRATEGY.PR;
  return MERGE_STRATEGY.LOCAL;
};

const waitForPrChecks = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<string | null> => {
  const sleep = input.sleep ?? sleepFor;
  const attempts = getCheckAttempts();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = evaluateChecks(await runner.gh(createCheckArgs(input.branch), { cwd: input.cwd }));
    if (outcome.status === CHECK_OUTCOME.SUCCESS) return null;
    if (outcome.status === CHECK_OUTCOME.FAILED) return outcome.note;
    if (attempt < attempts - 1) await sleep(PR_CHECK_POLL_MS);
  }

  return createPrChecksNote(CHECK_TIMEOUT_DETAIL);
};

const runPostMergeCleanup = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<CleanupOutcome> => {
  // After a successful merge we know branchMerged=true. The lifecycle issue is
  // closed in index.ts after this returns; we treat issueClosed=true here because
  // the merge has effectively committed to closing it. The classifier still
  // protects against dirty/untracked content.
  return runCleanup(runner, {
    cwd: input.cwd,
    worktree: input.worktree,
    branch: input.branch,
    baseBranch: getBaseBranch(input),
    issueClosed: true,
    branchMerged: true,
    issueNumber: input.issueNumber ?? deriveIssueNumber(input.branch) ?? 0,
    artifactPointers: input.artifactPointers ?? [],
    fsOps: input.fsOps,
  });
};

const injectAndCommentIfNeeded = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  prUrl: string,
): Promise<InjectOutcome> => {
  if (input.reviewSummarySection === undefined) return { ok: true, prUrl, note: null };

  const updated = await writeReviewSummaryToPrBody(runner, {
    cwd: input.cwd,
    branch: input.branch,
    section: input.reviewSummarySection,
  });
  if (updated.kind === "failed") return { ok: false, prUrl, note: updated.note };
  if (updated.kind === "no_pr") return { ok: false, prUrl, note: PR_BODY_DISAPPEARED_NOTE };
  if (input.postSummaryComment !== true) return { ok: true, prUrl, note: null };

  const posted = await postOnceSummaryComment(runner, {
    cwd: input.cwd,
    branch: input.branch,
    section: input.reviewSummarySection,
  });
  if (posted.kind === "failed") return { ok: true, prUrl, note: posted.note };
  return { ok: true, prUrl, note: null };
};

const finishViaPr = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const upserted = await upsertPullRequest(runner, {
    cwd: input.cwd,
    branch: input.branch,
    baseBranch: getBaseBranch(input),
  });
  if (upserted.kind === "failed") return createPreCleanupOutcome(false, null, upserted.note);

  const injected = await injectAndCommentIfNeeded(runner, input, upserted.url);
  if (!injected.ok) return createPreCleanupOutcome(false, injected.prUrl, injected.note);

  const checksNote = input.waitForChecks ? await waitForPrChecks(runner, input) : null;
  if (checksNote) return createPreCleanupOutcome(false, injected.prUrl, mergeNotes(injected.note, checksNote));

  const merged = await runner.gh([GH_PR, GH_MERGE, input.branch, GH_SQUASH_FLAG], { cwd: input.cwd });
  if (!completed(merged))
    return createPreCleanupOutcome(
      false,
      injected.prUrl,
      mergeNotes(injected.note, formatCommandFailure("gh_pr_merge", merged)),
    );

  const cleanup = await runPostMergeCleanup(runner, input);
  return createOutcome(true, injected.prUrl, cleanup, mergeNotes(injected.note, cleanupNote(cleanup)));
};

const runGitStep = async (
  runner: LifecycleRunner,
  args: readonly string[],
  cwd: string,
  label: string,
): Promise<string | null> => {
  const run = await runner.git(args, { cwd });
  if (completed(run)) return null;
  return formatCommandFailure(label, run);
};

const parsePathLines = (stdout: string): readonly string[] =>
  stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line.length > 0);

const parseStatusPaths = (stdout: string): readonly string[] =>
  stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length >= GIT_STATUS_PATH_OFFSET)
    .map((line) => line.slice(GIT_STATUS_PATH_OFFSET).trim())
    .map((path) => path.split(STATUS_RENAME_SEPARATOR).at(-1)?.trim() ?? path)
    .filter((path) => path.length > 0);

const readStatusPaths = async (runner: LifecycleRunner, worktree: string): Promise<readonly string[] | null> => {
  const status = await runner.git([GIT_STATUS, GIT_PORCELAIN_FLAG], { cwd: worktree });
  if (!completed(status)) return null;
  return parseStatusPaths(status.stdout);
};

const readUnmergedFiles = async (runner: LifecycleRunner, worktree: string): Promise<readonly string[]> => {
  const diff = await runner.git([GIT_DIFF, GIT_NAME_ONLY, GIT_UNMERGED_FILTER], { cwd: worktree });
  if (completed(diff)) return parsePathLines(diff.stdout);
  return readMergeConflicts(runner, worktree);
};

const isLikelyResolverExpansion = (path: string): boolean =>
  /(^|\/)tests?\/|\.test\.|(^|\/)(types|schemas|contracts)\.|(^|\/)types\/|(^|\/)(index|runner|tool)\./.test(path);

const inferConflictScopeFiles = (modifiedFiles: readonly string[]): readonly string[] => {
  if (modifiedFiles.length <= 1) return modifiedFiles;
  const primary =
    modifiedFiles.find((file) => file.startsWith("src/lifecycle/")) ??
    modifiedFiles.find((file) => !isLikelyResolverExpansion(file)) ??
    modifiedFiles[0];
  return primary === undefined ? [] : [primary];
};

const commitResolvedConflictMerge = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  worktree: string,
): Promise<string | null> =>
  runGitStep(
    runner,
    [GIT_COMMIT, GIT_MESSAGE_FLAG, `${RESOLVED_CONFLICT_COMMIT_PREFIX} ${input.branch}: resolve lifecycle conflicts`],
    worktree,
    "git_commit_resolved_conflicts",
  );

const createUnknownTempOutcome = (
  issueNumber: number,
  input: FinishLifecycleInput,
  note: string,
  worktree: string,
): FinishOutcome =>
  withHint(createPreCleanupOutcome(false, null, note), unknownHint(issueNumber, input.branch, note, worktree));

const createInvalidIssueNumberOutcome = (input: FinishLifecycleInput): FinishOutcome =>
  withHint(
    createPreCleanupOutcome(false, null, "invalid_issue_branch"),
    buildHint({
      failureKind: "invalid_issue_number",
      recommendedNextAction: "ask_user",
      summary: `cannot derive issue number from branch '${input.branch}'`,
      branch: input.branch,
    }),
  );

const createTempWorktreeFailureOutcome = (
  input: FinishLifecycleInput,
  issueNumber: number,
  reason: string,
  tmpPath: string,
): FinishOutcome =>
  withHint(
    createPreCleanupOutcome(false, null, `temp_worktree_create_failed: ${reason}`),
    buildHint({
      failureKind: "dirty_base_worktree",
      recommendedNextAction: "use_temp_merge_worktree",
      summary: reason,
      issueNumber,
      branch: input.branch,
      worktree: tmpPath,
      safeToRetry: false,
    }),
  );

const createScopeBlockedOutcome = (
  input: FinishLifecycleInput,
  issueNumber: number,
  worktree: string,
  modifiedFiles: readonly string[],
  scope: Extract<ConflictResolverScopeResult, { readonly status: "blocked" }>,
): FinishOutcome =>
  withHint(
    createPreCleanupOutcome(
      false,
      null,
      `merge_conflict: resolver scope blocked (${scope.reason}): ${scope.blockedFiles.join(CHECK_SEPARATOR)}`,
    ),
    buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "ask_user",
      summary: `resolved temp merge has blocked resolver scope (${scope.reason}); review modified files before committing`,
      issueNumber,
      branch: input.branch,
      worktree,
      conflictFiles: modifiedFiles,
      safeToRetry: false,
    }),
  );

const inspectExistingTempMergeWorktree = async (
  runner: LifecycleRunner,
  tmpPath: string,
): Promise<ExistingTempMergeWorktree | null> => {
  const modifiedFiles = await readStatusPaths(runner, tmpPath);
  if (modifiedFiles === null) return null;

  const unmergedFiles = await readUnmergedFiles(runner, tmpPath);
  if (modifiedFiles.length === 0 && unmergedFiles.length === 0) return null;

  return { kind: "existing", path: tmpPath, modifiedFiles, unmergedFiles };
};

const prepareTempMergeWorktree = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  issueNumber: number,
  baseBranch: string,
): Promise<PreparedTempMergeWorktree> => {
  const tmpPath = computeTempWorktreePath({ repoRoot: input.cwd, issueNumber, tmpDir: TMP_DIR });
  const create = await createTempMergeWorktree(runner, {
    repoRoot: input.cwd,
    issueNumber,
    baseBranch,
    tmpDir: TMP_DIR,
  });
  if (create.kind === "failed") {
    const existing = await inspectExistingTempMergeWorktree(runner, tmpPath);
    if (existing !== null) return existing;
    return { kind: "failed", outcome: createTempWorktreeFailureOutcome(input, issueNumber, create.reason, tmpPath) };
  }

  return { kind: "created", path: create.path };
};

const continueExistingTempMergeWorktree = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  issueNumber: number,
  prepared: ExistingTempMergeWorktree,
): Promise<FinishOutcome | null> => {
  if (prepared.unmergedFiles.length > 0) {
    return createMergeConflictOutcome(input, issueNumber, prepared.path, prepared.unmergedFiles);
  }

  const conflictFiles = inferConflictScopeFiles(prepared.modifiedFiles);
  const scope = evaluateConflictResolverScope({ conflictFiles, modifiedFiles: prepared.modifiedFiles });
  if (scope.status === "blocked") {
    return createScopeBlockedOutcome(input, issueNumber, prepared.path, prepared.modifiedFiles, scope);
  }

  const commitNote = await commitResolvedConflictMerge(runner, input, prepared.path);
  if (commitNote) return createUnknownTempOutcome(issueNumber, input, commitNote, prepared.path);
  return null;
};

const resolvePreparedTempMerge = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  issueNumber: number,
  prepared: Exclude<PreparedTempMergeWorktree, { readonly kind: "failed" }>,
): Promise<FinishOutcome | null> => {
  if (prepared.kind === "existing") return continueExistingTempMergeWorktree(runner, input, issueNumber, prepared);
  return mergeIssueBranchIntoBase(runner, input, issueNumber, prepared.path);
};

const createMergeConflictOutcome = (
  input: FinishLifecycleInput,
  issueNumber: number,
  worktree: string,
  conflictFiles: readonly string[],
): FinishOutcome =>
  withHint(
    createPreCleanupOutcome(false, null, "merge_conflict"),
    buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: `merge conflicts in ${conflictFiles.length} file(s); resolve in temp worktree then retry`,
      issueNumber,
      branch: input.branch,
      worktree,
      conflictFiles,
      safeToRetry: false,
    }),
  );

const mergeIssueBranchIntoBase = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  issueNumber: number,
  worktree: string,
): Promise<FinishOutcome | null> => {
  const merged = await runner.git([GIT_MERGE, GIT_NO_FF_FLAG, input.branch], { cwd: worktree });
  if (completed(merged)) return null;

  const conflictFiles = await readMergeConflicts(runner, worktree);
  if (conflictFiles.length > 0) return createMergeConflictOutcome(input, issueNumber, worktree, conflictFiles);

  const note = formatCommandFailure("git_merge", merged);
  return createUnknownTempOutcome(issueNumber, input, note, worktree);
};

const pushMergedBaseBranch = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  issueNumber: number,
  baseBranch: string,
  worktree: string,
): Promise<FinishOutcome | null> => {
  const pushed = await runner.git([GIT_PUSH, GIT_ORIGIN, `HEAD:${baseBranch}`], { cwd: worktree });
  if (completed(pushed)) return null;

  const pushNote = formatCommandFailure("git_push", pushed);
  const removed = await removeTempMergeWorktree(runner, { repoRoot: input.cwd, path: worktree });
  const removeNote = completed(removed) ? null : formatCommandFailure("temp_worktree_remove_failed", removed);
  const safeToRetry = completed(removed);
  const note = mergeNotes(pushNote, removeNote);
  return withHint(
    createPreCleanupOutcome(false, null, note),
    buildHint({
      failureKind: "push_failed",
      recommendedNextAction: safeToRetry ? "retry_finish" : "ask_user",
      summary: mergeNotes(pushed.stderr || pushed.stdout || "push failed", removeNote) ?? "push failed",
      issueNumber,
      branch: input.branch,
      worktree,
      safeToRetry,
    }),
  );
};

const deleteBranchIfWorktreeRemoved = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  cleanup: CleanupOutcome,
): Promise<string | null> => {
  if (!worktreeRemovedFromCleanup(cleanup)) return null;
  return runGitStep(runner, [GIT_BRANCH, GIT_DELETE_FLAG, input.branch], input.cwd, "git_branch_delete");
};

const finishViaLocalMerge = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const baseBranch = getBaseBranch(input);
  const issueNumber = deriveIssueNumber(input.branch);
  if (issueNumber === null) return createInvalidIssueNumberOutcome(input);

  const prepared = await prepareTempMergeWorktree(runner, input, issueNumber, baseBranch);
  if (prepared.kind === "failed") return prepared.outcome;

  const mergeFailure = await resolvePreparedTempMerge(runner, input, issueNumber, prepared);
  if (mergeFailure) return mergeFailure;

  const pushFailure = await pushMergedBaseBranch(runner, input, issueNumber, baseBranch, prepared.path);
  if (pushFailure) return pushFailure;

  await removeTempMergeWorktree(runner, { repoRoot: input.cwd, path: prepared.path });

  const cleanup = await runPostMergeCleanup(runner, input);
  // Only attempt branch deletion when the worktree actually went away; deleting the
  // branch while the worktree still references it would fail and add noise.
  const branchDeleteNote = await deleteBranchIfWorktreeRemoved(runner, input, cleanup);

  return createOutcome(true, null, cleanup, mergeNotes(cleanupNote(cleanup), branchDeleteNote));
};

export async function finishLifecycle(runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> {
  const strategy = await resolveStrategy(runner, input);
  if (strategy === MERGE_STRATEGY.PR) return finishViaPr(runner, input);
  return finishViaLocalMerge(runner, input);
}
