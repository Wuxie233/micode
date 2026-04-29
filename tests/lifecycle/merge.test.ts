import { describe, expect, it } from "bun:test";

import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const WORKTREE = "/repo/micode-issue-1";
const BRANCH = "issue/1-lifecycle";
const PR_URL = "https://github.com/Wuxie233/micode/pull/12";

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
      const result = outputs.git?.[gitIndex] ?? createRun();
      gitIndex += 1;
      return result;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const result = outputs.gh?.[ghIndex] ?? createRun();
      ghIndex += 1;
      return result;
    },
  };
};

describe("finishLifecycle", () => {
  it("opens a PR against the resolved main branch", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "main", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against master when resolved base is master", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "master", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against a custom default branch", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "trunk",
      sleep: async () => {},
    });

    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "trunk", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("local merge checks out and pushes the resolved master branch", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [createRun(), createRun(), createRun(), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    const gitCalls = runner.calls.filter((call) => call.bin === "git");
    expect(gitCalls[0]).toEqual({ bin: "git", args: ["checkout", "master"], cwd: CWD });
    expect(gitCalls[1]).toEqual({ bin: "git", args: ["merge", "--no-ff", BRANCH], cwd: CWD });
    expect(gitCalls[2]).toEqual({ bin: "git", args: ["push", "origin", "master"], cwd: CWD });
  });

  it("returns an actionable error when checkout of the resolved base branch fails", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [{ stdout: "", stderr: "error: pathspec 'master' did not match any file(s)", exitCode: FAILURE_EXIT_CODE }],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "local-merge",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("git_checkout");
    expect(outcome.note).toContain("master");
  });

  it("throws a clear error when baseBranch is missing", async () => {
    const runner = createRunner({});
    await expect(
      finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree: WORKTREE,
        mergeStrategy: "pr",
        waitForChecks: true,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/base branch not resolved/i);
  });
});

describe("PR_CHECK_POLL_MS", () => {
  it("is exported as a positive number for waitForPrChecks scheduling", () => {
    expect(PR_CHECK_POLL_MS).toBeGreaterThan(0);
  });
});
