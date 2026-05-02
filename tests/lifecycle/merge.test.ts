import { describe, expect, it } from "bun:test";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const WORKTREE = "/repo/micode-issue-1";
const BRANCH = "issue/1-lifecycle";
const PR_URL = "https://github.com/Wuxie233/micode/pull/12";
const PR_NUMBER = 12;
const REVIEW_SUMMARY = "## AI Review Summary\n- Looks safe";

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

const createFailure = (stderr = "failed"): RunResult => ({
  stdout: EMPTY_OUTPUT,
  stderr,
  exitCode: FAILURE_EXIT_CODE,
});

const createPrView = (body = EMPTY_OUTPUT): RunResult =>
  createRun(JSON.stringify({ number: PR_NUMBER, url: PR_URL, body }));

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
      gh: [
        createFailure("no pull requests found"),
        createRun(`${PR_URL}\n`),
        createPrView(),
        createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])),
        createRun(),
      ],
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
    expect(runner.calls[1]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "main", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against master when resolved base is master", async () => {
    const runner = createRunner({
      gh: [
        createFailure("no pull requests found"),
        createRun(`${PR_URL}\n`),
        createPrView(),
        createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])),
        createRun(),
      ],
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

    expect(runner.calls[1]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "master", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against a custom default branch", async () => {
    const runner = createRunner({
      gh: [
        createFailure("no pull requests found"),
        createRun(`${PR_URL}\n`),
        createPrView(),
        createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])),
        createRun(),
      ],
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

    expect(runner.calls[1]).toEqual({
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

  it("reuses existing PR, injects summary into body, then merges", async () => {
    const runner = createRunner({
      gh: [createPrView("Existing body."), createPrView("Existing body."), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.prUrl).toBe(PR_URL);
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[1] === "create")).toBe(false);
    const bodyArg = runner.calls[2]?.args[runner.calls[2].args.length - 1] ?? EMPTY_OUTPUT;
    expect(bodyArg).toContain("Existing body.");
    expect(bodyArg).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(bodyArg).toContain(REVIEW_SUMMARY);
    expect(runner.calls[3]).toEqual({ bin: "gh", args: ["pr", "merge", BRANCH, "--squash"], cwd: CWD });
  });

  it("creates PR when none exists then injects summary", async () => {
    const runner = createRunner({
      gh: [
        createFailure("no pull requests found"),
        createRun(`${PR_URL}\n`),
        createPrView(),
        createPrView(),
        createRun(),
        createRun(),
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
    });

    expect(outcome.merged).toBe(true);
    expect(runner.calls[1]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "main", "--head", BRANCH],
      cwd: CWD,
    });
    expect(runner.calls[4]?.args[0]).toBe("pr");
    expect(runner.calls[4]?.args[1]).toBe("edit");
  });

  it("blocks merge with pr_body_update_failed when summary injection fails", async () => {
    const runner = createRunner({
      gh: [createPrView(), createPrView(), createFailure("permission denied")],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("pr_body_update_failed");
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[1] === "merge")).toBe(false);
  });

  it("posts one PR comment when postSummaryComment true", async () => {
    const runner = createRunner({
      gh: [createPrView(), createPrView(), createRun(), createRun("[]"), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
      postSummaryComment: true,
    });

    expect(outcome.merged).toBe(true);
    const comments = runner.calls.filter((call) => call.bin === "gh" && call.args[1] === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.args[comments[0].args.length - 1]).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT);
  });

  it("does not block merge when optional comment posting fails, note contains pr_comment_failed", async () => {
    const runner = createRunner({
      gh: [createPrView(), createPrView(), createRun(), createRun("[]"), createFailure("rate limited"), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
      postSummaryComment: true,
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.note).toContain("pr_comment_failed");
  });

  it("local merge path still works and does not call pr edit or comment", async () => {
    const runner = createRunner({
      git: [createRun(), createRun(), createRun(), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
      reviewSummarySection: REVIEW_SUMMARY,
      postSummaryComment: true,
    });

    expect(outcome.merged).toBe(true);
    expect(runner.calls.some((call) => call.bin === "gh" && ["edit", "comment"].includes(call.args[1] ?? ""))).toBe(
      false,
    );
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
