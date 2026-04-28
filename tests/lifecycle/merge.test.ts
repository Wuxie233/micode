import { describe, expect, it } from "bun:test";

import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const WORKTREE = "/repo/micode-issue-1";
const BRANCH = "issue/1-lifecycle";
const MAIN_BRANCH = "main";
const PR_URL = "https://github.com/Wuxie233/micode/pull/12";
const CHECK_ARGS = ["pr", "checks", BRANCH, "--required", "--json", "state,name"] as const;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

interface RunnerOutputs {
  readonly git?: readonly RunResult[];
  readonly gh?: readonly RunResult[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createRunner = (outputs: RunnerOutputs): FakeRunner => {
  const calls: RunnerCall[] = [];
  let gitIndex = 0;
  let ghIndex = 0;

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const run = outputs.git?.[gitIndex] ?? createRun();
      gitIndex += 1;
      return run;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const run = outputs.gh?.[ghIndex] ?? createRun();
      ghIndex += 1;
      return run;
    },
  };
};

describe("finishLifecycle", () => {
  it("opens a PR, waits for required checks, and squash merges", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      sleep: async () => {},
    });

    expect(outcome).toEqual({
      merged: true,
      prUrl: PR_URL,
      closedAt: null,
      worktreeRemoved: true,
      note: null,
    });
    expect(runner.calls).toEqual([
      { bin: "gh", args: ["pr", "create", "--fill", "--base", MAIN_BRANCH, "--head", BRANCH], cwd: CWD },
      { bin: "gh", args: CHECK_ARGS, cwd: CWD },
      { bin: "gh", args: ["pr", "merge", BRANCH, "--squash"], cwd: CWD },
      { bin: "git", args: ["worktree", "remove", WORKTREE] },
    ]);
  });

  it("uses local merge when auto finds no required CI checks", async () => {
    const runner = createRunner({ gh: [createRun("[]")] });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: true,
      sleep: async () => {},
    });

    expect(outcome).toEqual({
      merged: true,
      prUrl: null,
      closedAt: null,
      worktreeRemoved: true,
      note: null,
    });
    expect(runner.calls).toEqual([
      { bin: "gh", args: CHECK_ARGS, cwd: CWD },
      { bin: "git", args: ["checkout", MAIN_BRANCH], cwd: CWD },
      { bin: "git", args: ["merge", "--no-ff", BRANCH], cwd: CWD },
      { bin: "git", args: ["push", "origin", MAIN_BRANCH], cwd: CWD },
      { bin: "git", args: ["worktree", "remove", WORKTREE] },
      { bin: "git", args: ["branch", "-d", BRANCH], cwd: CWD },
    ]);
  });

  it("returns a contract-prefixed note when required checks fail", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "FAILURE", name: "lint" }]))],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.prUrl).toBe(PR_URL);
    expect(outcome.worktreeRemoved).toBe(false);
    expect(outcome.note).toStartWith("pr_checks_failed:");
    expect(runner.calls).toEqual([
      { bin: "gh", args: ["pr", "create", "--fill", "--base", MAIN_BRANCH, "--head", BRANCH], cwd: CWD },
      { bin: "gh", args: CHECK_ARGS, cwd: CWD },
    ]);
  });

  it("exposes the configured PR check polling interval", () => {
    expect(PR_CHECK_POLL_MS).toBe(30_000);
  });
});
