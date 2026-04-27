import * as v from "valibot";

import { config } from "@/utils/config";

import type { LifecycleRunner, RunResult } from "./runner";
import type { FinishInput, FinishOutcome } from "./types";

export const PR_CHECK_POLL_MS = 30_000;

export interface FinishLifecycleInput {
  readonly cwd: string;
  readonly branch: string;
  readonly worktree: string;
  readonly mergeStrategy?: FinishInput["mergeStrategy"] | "auto";
  readonly waitForChecks: boolean;
  readonly baseBranch?: string;
  readonly sleep?: (ms: number) => Promise<void>;
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
const MAIN_BRANCH = "main";
const PR_CHECKS_FAILED = "pr_checks_failed";
const CHECK_TIMEOUT_DETAIL = "timeout";
const OUTPUT_SEPARATOR = " ";
const DETAIL_SEPARATOR = ": ";
const CHECK_SEPARATOR = ", ";
const PR_URL_PATTERN = /https:\/\/github\.com\/\S+\/pull\/\d+/;

const GH_PR = "pr";
const GH_CREATE = "create";
const GH_CHECKS = "checks";
const GH_MERGE = "merge";
const GH_FILL_FLAG = "--fill";
const GH_BASE_FLAG = "--base";
const GH_HEAD_FLAG = "--head";
const GH_REQUIRED_FLAG = "--required";
const GH_JSON_FLAG = "--json";
const GH_CHECK_FIELDS = "state,name";
const GH_SQUASH_FLAG = "--squash";

const GIT_CHECKOUT = "checkout";
const GIT_MERGE = "merge";
const GIT_NO_FF_FLAG = "--no-ff";
const GIT_PUSH = "push";
const GIT_ORIGIN = "origin";
const GIT_WORKTREE = "worktree";
const GIT_REMOVE = "remove";
const GIT_BRANCH = "branch";
const GIT_DELETE_FLAG = "-d";

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

interface CleanupOutcome {
  readonly worktreeRemoved: boolean;
  readonly note: string | null;
}

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const getBaseBranch = (input: FinishLifecycleInput): string => input.baseBranch ?? MAIN_BRANCH;

const createOutcome = (
  merged: boolean,
  prUrl: string | null,
  worktreeRemoved: boolean,
  note: string | null,
): FinishOutcome => ({
  merged,
  prUrl,
  closedAt: null,
  worktreeRemoved,
  note,
});

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

const extractPrUrl = (stdout: string): string | null => PR_URL_PATTERN.exec(stdout)?.[0] ?? null;

const sleepFor = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

const getCheckAttempts = (): number => Math.max(1, Math.ceil(config.lifecycle.prCheckTimeoutMs / PR_CHECK_POLL_MS) + 1);

const hasRemoteCi = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<boolean> => {
  const inspected = await runner.gh(createCheckArgs(input.branch));
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
    const outcome = evaluateChecks(await runner.gh(createCheckArgs(input.branch)));
    if (outcome.status === CHECK_OUTCOME.SUCCESS) return null;
    if (outcome.status === CHECK_OUTCOME.FAILED) return outcome.note;
    if (attempt < attempts - 1) await sleep(PR_CHECK_POLL_MS);
  }

  return createPrChecksNote(CHECK_TIMEOUT_DETAIL);
};

const cleanupPr = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<CleanupOutcome> => {
  const removed = await runner.git([GIT_WORKTREE, GIT_REMOVE, input.worktree]);
  if (completed(removed)) return { worktreeRemoved: true, note: null };
  return { worktreeRemoved: false, note: formatCommandFailure("git_worktree_remove", removed) };
};

const cleanupLocal = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<CleanupOutcome> => {
  const removed = await runner.git([GIT_WORKTREE, GIT_REMOVE, input.worktree]);
  const deleted = await runner.git([GIT_BRANCH, GIT_DELETE_FLAG, input.branch], { cwd: input.cwd });
  if (!completed(removed))
    return { worktreeRemoved: false, note: formatCommandFailure("git_worktree_remove", removed) };
  if (!completed(deleted)) return { worktreeRemoved: true, note: formatCommandFailure("git_branch_delete", deleted) };
  return { worktreeRemoved: true, note: null };
};

const finishViaPr = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const opened = await runner.gh([
    GH_PR,
    GH_CREATE,
    GH_FILL_FLAG,
    GH_BASE_FLAG,
    getBaseBranch(input),
    GH_HEAD_FLAG,
    input.branch,
  ]);
  const prUrl = extractPrUrl(opened.stdout);
  if (!completed(opened)) return createOutcome(false, prUrl, false, formatCommandFailure("gh_pr_create", opened));

  const checksNote = input.waitForChecks ? await waitForPrChecks(runner, input) : null;
  if (checksNote) return createOutcome(false, prUrl, false, checksNote);

  const merged = await runner.gh([GH_PR, GH_MERGE, input.branch, GH_SQUASH_FLAG]);
  if (!completed(merged)) return createOutcome(false, prUrl, false, formatCommandFailure("gh_pr_merge", merged));

  const cleanup = await cleanupPr(runner, input);
  return createOutcome(true, prUrl, cleanup.worktreeRemoved, cleanup.note);
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

const finishViaLocalMerge = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const baseBranch = getBaseBranch(input);
  const checkoutNote = await runGitStep(runner, [GIT_CHECKOUT, baseBranch], input.cwd, "git_checkout");
  if (checkoutNote) return createOutcome(false, null, false, checkoutNote);

  const mergeNote = await runGitStep(runner, [GIT_MERGE, GIT_NO_FF_FLAG, input.branch], input.cwd, "git_merge");
  if (mergeNote) return createOutcome(false, null, false, mergeNote);

  const pushNote = await runGitStep(runner, [GIT_PUSH, GIT_ORIGIN, baseBranch], input.cwd, "git_push");
  if (pushNote) return createOutcome(false, null, false, pushNote);

  const cleanup = await cleanupLocal(runner, input);
  return createOutcome(true, null, cleanup.worktreeRemoved, cleanup.note);
};

export async function finishLifecycle(runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> {
  const strategy = await resolveStrategy(runner, input);
  if (strategy === MERGE_STRATEGY.PR) return finishViaPr(runner, input);
  return finishViaLocalMerge(runner, input);
}
