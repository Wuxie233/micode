import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { buildLifecycleCommitMessage, type CommitMessageInput } from "./commit-message";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CommitOutcome } from "./types";

export interface CommitAndPushInput {
  readonly cwd: string;
  readonly issueNumber: number;
  readonly branch: string;
  readonly type: CommitMessageInput["type"];
  readonly scope: string;
  readonly summary: string;
  readonly push: boolean;
  readonly marker?: string;
  readonly preStageHook?: (cwd: string, issueNumber: number) => Promise<void>;
  readonly prePushHook?: (cwd: string, issueNumber: number, changedPaths: readonly string[]) => Promise<void>;
}

const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const NOTHING_TO_COMMIT_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const NOTHING_TO_COMMIT_PATTERN = /nothing to commit/i;
const STAGE_ARGS = ["add", "--all"] as const;
const SHA_ARGS = ["rev-parse", "HEAD"] as const;
const CHANGED_PATHS_ARGS = ["diff-tree", "--no-commit-id", "--name-only", "-r"] as const;
const COMMIT_COMMAND = "commit";
const MESSAGE_FLAG = "-m";
const PUSH_COMMAND = "push";
const SET_UPSTREAM_FLAG = "--set-upstream";
const ORIGIN_REMOTE = "origin";
const STAGING_FAILED_NOTE = "Staging failed";
const COMMIT_FAILED_NOTE = "Commit failed";
const SHA_FAILED_NOTE = "Commit SHA lookup failed";
const PUSH_FAILED_NOTE = "Push failed after retry";
const PRE_STAGE_HOOK_FAILED_NOTE = "preStageHook failed";
const PRE_PUSH_BLOCKED_NOTE = "Pre-push hook blocked push";
const LOG_MODULE = "lifecycle.commits";

const buildPushArgs = (branch: string): readonly string[] => [PUSH_COMMAND, SET_UPSTREAM_FLAG, ORIGIN_REMOTE, branch];

const uncommittedOutcome = (): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note: null,
});

const failureOutcome = (note: string): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note,
});

const completedOutcome = (sha: string, pushed: boolean, retried: boolean): CommitOutcome => ({
  committed: true,
  sha,
  pushed,
  retried,
  note: null,
});

const retainedOutcome = (sha: string | null, retried: boolean, note: string): CommitOutcome => ({
  committed: true,
  sha,
  pushed: false,
  retried,
  note,
});

const succeeded = (run: RunResult): boolean => run.exitCode === SUCCESS_EXIT_CODE;

const output = (run: RunResult): string => `${run.stdout}\n${run.stderr}`.trim();

const noteFor = (prefix: string, run: RunResult): string => {
  const message = output(run);
  if (message.length === 0) return prefix;
  return `${prefix}: ${message}`;
};

const isNothingToCommit = (run: RunResult): boolean => {
  return run.exitCode === NOTHING_TO_COMMIT_EXIT_CODE && NOTHING_TO_COMMIT_PATTERN.test(output(run));
};

const runGit = async (runner: LifecycleRunner, args: readonly string[], cwd: string): Promise<RunResult> => {
  try {
    return await runner.git(args, { cwd });
  } catch (error) {
    return { stdout: EMPTY_OUTPUT, stderr: extractErrorMessage(error), exitCode: FAILURE_EXIT_CODE };
  }
};

const runPreStageHook = async (input: CommitAndPushInput): Promise<void> => {
  if (!input.preStageHook) return;

  try {
    await input.preStageHook(input.cwd, input.issueNumber);
  } catch (error) {
    log.warn(LOG_MODULE, `${PRE_STAGE_HOOK_FAILED_NOTE}: ${extractErrorMessage(error)}`);
  }
};

const readSha = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const run = await runGit(runner, SHA_ARGS, cwd);
  if (!succeeded(run)) return null;

  const sha = run.stdout.trim();
  if (sha.length === 0) return null;
  return sha;
};

const readChangedPaths = async (runner: LifecycleRunner, cwd: string, sha: string): Promise<readonly string[]> => {
  const run = await runGit(runner, [...CHANGED_PATHS_ARGS, sha], cwd);
  if (!succeeded(run)) return [];
  return run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const runPrePushHook = async (
  runner: LifecycleRunner,
  input: CommitAndPushInput,
  sha: string,
): Promise<string | null> => {
  if (!input.prePushHook) return null;
  try {
    const changedPaths = await readChangedPaths(runner, input.cwd, sha);
    await input.prePushHook(input.cwd, input.issueNumber, changedPaths);
    return null;
  } catch (error) {
    return `${PRE_PUSH_BLOCKED_NOTE}: ${extractErrorMessage(error)}`;
  }
};

const pushWithRetry = async (
  runner: LifecycleRunner,
  cwd: string,
  branch: string,
  sha: string,
): Promise<CommitOutcome> => {
  const pushArgs = buildPushArgs(branch);
  const pushed = await runGit(runner, pushArgs, cwd);
  if (succeeded(pushed)) return completedOutcome(sha, true, false);

  await Bun.sleep(config.lifecycle.pushRetryBackoffMs);

  const retried = await runGit(runner, pushArgs, cwd);
  if (succeeded(retried)) return completedOutcome(sha, true, true);
  return retainedOutcome(sha, true, noteFor(PUSH_FAILED_NOTE, retried));
};

export async function commitAndPush(runner: LifecycleRunner, input: CommitAndPushInput): Promise<CommitOutcome> {
  let message: string;
  try {
    message = buildLifecycleCommitMessage({ ...input, marker: input.marker });
  } catch (error) {
    return failureOutcome(extractErrorMessage(error));
  }

  await runPreStageHook(input);

  const staged = await runGit(runner, STAGE_ARGS, input.cwd);
  if (!succeeded(staged)) return failureOutcome(noteFor(STAGING_FAILED_NOTE, staged));

  const committed = await runGit(runner, [COMMIT_COMMAND, MESSAGE_FLAG, message], input.cwd);
  if (isNothingToCommit(committed)) return uncommittedOutcome();
  if (!succeeded(committed)) return failureOutcome(noteFor(COMMIT_FAILED_NOTE, committed));

  const sha = await readSha(runner, input.cwd);
  if (sha === null) return retainedOutcome(null, false, SHA_FAILED_NOTE);
  if (!input.push) return completedOutcome(sha, false, false);
  const blocked = await runPrePushHook(runner, input, sha);
  if (blocked !== null) return retainedOutcome(sha, false, blocked);
  return pushWithRetry(runner, input.cwd, input.branch, sha);
}
