import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

import { buildLifecycleCommitMessage, type CommitMessageInput } from "./commit-message";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CommitOutcome } from "./types";

export interface CommitAndPushInput {
  readonly cwd: string;
  readonly issueNumber: number;
  readonly type: CommitMessageInput["type"];
  readonly scope: string;
  readonly summary: string;
  readonly push: boolean;
}

const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const NOTHING_TO_COMMIT_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const NOTHING_TO_COMMIT_PATTERN = /nothing to commit/i;
const STAGE_ARGS = ["add", "--all"] as const;
const PUSH_ARGS = ["push"] as const;
const SHA_ARGS = ["rev-parse", "HEAD"] as const;
const COMMIT_COMMAND = "commit";
const MESSAGE_FLAG = "-m";
const STAGING_FAILED_NOTE = "Staging failed";
const COMMIT_FAILED_NOTE = "Commit failed";
const SHA_FAILED_NOTE = "Commit SHA lookup failed";
const PUSH_FAILED_NOTE = "Push failed after retry";

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

const readSha = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const run = await runGit(runner, SHA_ARGS, cwd);
  if (!succeeded(run)) return null;

  const sha = run.stdout.trim();
  if (sha.length === 0) return null;
  return sha;
};

const pushWithRetry = async (runner: LifecycleRunner, cwd: string, sha: string): Promise<CommitOutcome> => {
  const pushed = await runGit(runner, PUSH_ARGS, cwd);
  if (succeeded(pushed)) return completedOutcome(sha, true, false);

  await Bun.sleep(config.lifecycle.pushRetryBackoffMs);

  const retried = await runGit(runner, PUSH_ARGS, cwd);
  if (succeeded(retried)) return completedOutcome(sha, true, true);
  return retainedOutcome(sha, true, noteFor(PUSH_FAILED_NOTE, retried));
};

export async function commitAndPush(runner: LifecycleRunner, input: CommitAndPushInput): Promise<CommitOutcome> {
  let message: string;
  try {
    message = buildLifecycleCommitMessage(input);
  } catch (error) {
    return failureOutcome(extractErrorMessage(error));
  }

  const staged = await runGit(runner, STAGE_ARGS, input.cwd);
  if (!succeeded(staged)) return failureOutcome(noteFor(STAGING_FAILED_NOTE, staged));

  const committed = await runGit(runner, [COMMIT_COMMAND, MESSAGE_FLAG, message], input.cwd);
  if (isNothingToCommit(committed)) return uncommittedOutcome();
  if (!succeeded(committed)) return failureOutcome(noteFor(COMMIT_FAILED_NOTE, committed));

  const sha = await readSha(runner, input.cwd);
  if (sha === null) return retainedOutcome(null, false, SHA_FAILED_NOTE);
  if (!input.push) return completedOutcome(sha, false, false);
  return pushWithRetry(runner, input.cwd, sha);
}
