import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { type CommitAndPushInput, commitAndPush } from "@/lifecycle/commits";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { config } from "@/utils/config";

const CWD = "/workspace/micode";
const ISSUE_NUMBER = 42;
const SHA = "abc123def456";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const CLEAN_OUTPUT = "On branch issue/42\nnothing to commit, working tree clean\n";
const PUSH_FAILURE = "remote rejected push";
const MESSAGE = "feat(lifecycle): add commit flow (#42)";
const STAGE_ARGS = ["add", "--all"] as const;
const COMMIT_ARGS = ["commit", "-m", MESSAGE] as const;
const SHA_ARGS = ["rev-parse", "HEAD"] as const;
const PUSH_ARGS = ["push"] as const;

interface RunnerCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

const INPUT: CommitAndPushInput = {
  cwd: CWD,
  issueNumber: ISSUE_NUMBER,
  type: "feat",
  scope: "lifecycle",
  summary: "add commit flow",
  push: true,
};

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE, stderr = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr,
  exitCode,
});

const createRunner = (runs: readonly RunResult[]): FakeRunner => {
  const calls: RunnerCall[] = [];
  let cursor = 0;

  return {
    calls,
    git: async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      const run = runs[cursor] ?? createRun();
      cursor += 1;
      return run;
    },
    gh: async (_args) => createRun(),
  };
};

describe("commitAndPush", () => {
  let sleep: ReturnType<typeof spyOn>;

  beforeEach(() => {
    sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    sleep.mockRestore();
  });

  it("returns an uncommitted outcome for a clean tree", async () => {
    const runner = createRunner([createRun(), createRun(CLEAN_OUTPUT, FAILURE_EXIT_CODE)]);

    const outcome = await commitAndPush(runner, INPUT);

    expect(outcome).toEqual({ committed: false, sha: null, pushed: false, retried: false, note: null });
    expect(runner.calls).toEqual([
      { args: STAGE_ARGS, cwd: CWD },
      { args: COMMIT_ARGS, cwd: CWD },
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("commits and pushes changes", async () => {
    const runner = createRunner([createRun(), createRun(), createRun(`${SHA}\n`), createRun()]);

    const outcome = await commitAndPush(runner, INPUT);

    expect(outcome).toEqual({ committed: true, sha: SHA, pushed: true, retried: false, note: null });
    expect(runner.calls).toEqual([
      { args: STAGE_ARGS, cwd: CWD },
      { args: COMMIT_ARGS, cwd: CWD },
      { args: SHA_ARGS, cwd: CWD },
      { args: PUSH_ARGS, cwd: CWD },
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries push once after a failure", async () => {
    const runner = createRunner([
      createRun(),
      createRun(),
      createRun(`${SHA}\n`),
      createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE, PUSH_FAILURE),
      createRun(),
    ]);

    const outcome = await commitAndPush(runner, INPUT);

    expect(outcome).toEqual({ committed: true, sha: SHA, pushed: true, retried: true, note: null });
    expect(runner.calls).toEqual([
      { args: STAGE_ARGS, cwd: CWD },
      { args: COMMIT_ARGS, cwd: CWD },
      { args: SHA_ARGS, cwd: CWD },
      { args: PUSH_ARGS, cwd: CWD },
      { args: PUSH_ARGS, cwd: CWD },
    ]);
    expect(sleep).toHaveBeenCalledWith(config.lifecycle.pushRetryBackoffMs);
  });

  it("keeps the local commit when push retry fails", async () => {
    const runner = createRunner([
      createRun(),
      createRun(),
      createRun(`${SHA}\n`),
      createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE, PUSH_FAILURE),
      createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE, PUSH_FAILURE),
    ]);

    const outcome = await commitAndPush(runner, INPUT);

    expect(outcome.committed).toBe(true);
    expect(outcome.sha).toBe(SHA);
    expect(outcome.pushed).toBe(false);
    expect(outcome.retried).toBe(true);
    expect(outcome.note).toContain(PUSH_FAILURE);
    expect(runner.calls).toEqual([
      { args: STAGE_ARGS, cwd: CWD },
      { args: COMMIT_ARGS, cwd: CWD },
      { args: SHA_ARGS, cwd: CWD },
      { args: PUSH_ARGS, cwd: CWD },
      { args: PUSH_ARGS, cwd: CWD },
    ]);
    expect(sleep).toHaveBeenCalledWith(config.lifecycle.pushRetryBackoffMs);
  });
});
