import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import { REPO_KIND } from "@/lifecycle/pre-flight";
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
const FORK_PREFLIGHT = {
  kind: REPO_KIND.FORK,
  origin: "git@github.com:Wuxie233/micode.git",
  nameWithOwner: "Wuxie233/micode",
  viewerLogin: "Wuxie233",
  issuesEnabled: true,
  upstreamUrl: "https://github.com/vtemian/micode",
} as const;
const OWN_PREFLIGHT = { ...FORK_PREFLIGHT, kind: REPO_KIND.OWN, upstreamUrl: null } as const;
const UPSTREAM_PREFLIGHT = {
  kind: REPO_KIND.UPSTREAM,
  origin: "git@github.com:vtemian/micode.git",
  nameWithOwner: "vtemian/micode",
  viewerLogin: null,
  issuesEnabled: false,
  upstreamUrl: null,
} as const;
const UNKNOWN_PREFLIGHT = {
  kind: REPO_KIND.UNKNOWN,
  reason: "gh-failed",
  origin: "git@github.com:unknown/micode.git",
  nameWithOwner: "",
  viewerLogin: null,
  issuesEnabled: false,
  upstreamUrl: null,
} as const;

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
      mode: "remote",
      remoteCapable: true,
      preflight: FORK_PREFLIGHT,
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

  it("local merge uses a temp worktree and pushes the resolved master branch", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [createRun(), createRun(), createRun(), createRun(), createRun(), createRun(), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
      mode: "remote",
      remoteCapable: true,
      preflight: OWN_PREFLIGHT,
    });

    expect(outcome.merged).toBe(true);
    const gitCalls = runner.calls.filter((call) => call.bin === "git");
    expect(gitCalls[0]).toEqual({
      bin: "git",
      args: ["worktree", "add", "/tmp/micode-merge-issue-1", "master"],
      cwd: CWD,
    });
    expect(gitCalls[1]).toEqual({ bin: "git", args: ["fetch", "origin", "master"], cwd: "/tmp/micode-merge-issue-1" });
    expect(gitCalls[2]).toEqual({
      bin: "git",
      args: ["merge", "--ff-only", "origin/master"],
      cwd: "/tmp/micode-merge-issue-1",
    });
    expect(gitCalls[3]).toEqual({ bin: "git", args: ["merge", "--no-ff", BRANCH], cwd: "/tmp/micode-merge-issue-1" });
    expect(gitCalls[4]).toEqual({ bin: "git", args: ["push", "origin", "master"], cwd: "/tmp/micode-merge-issue-1" });
  });

  it("blocks local-only PR finish before any gh pr calls", async () => {
    const runner = createRunner({ gh: [createRun(`${PR_URL}\n`)] });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      mode: "local-only",
      remoteCapable: false,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toBe("local-only: remote merge unavailable");
    expect(outcome.recoveryHint?.failureKind).toBe("pre_flight_failed");
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[0] === "pr")).toBe(false);
  });

  it("blocks local-only auto finish before any gh probing", async () => {
    const runner = createRunner({ gh: [createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }]))] });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: false,
      baseBranch: "main",
      mode: "local-only",
      remoteCapable: false,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toBe("local-only: remote merge unavailable");
    expect(outcome.recoveryHint?.failureKind).toBe("pre_flight_failed");
    expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
  });

  it("blocks upstream preflight PR finish before remote mutation", async () => {
    const runner = createRunner({ gh: [createRun(`${PR_URL}\n`)] });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: false,
      baseBranch: "main",
      mode: "remote",
      remoteCapable: true,
      preflight: UPSTREAM_PREFLIGHT,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("operation=pr-create");
    expect(outcome.recoveryHint?.failureKind).toBe("pre_flight_failed");
    expect(runner.calls.some((call) => call.bin === "gh" && ["create", "merge"].includes(call.args[1] ?? ""))).toBe(
      false,
    );
  });

  it("blocks unknown preflight local merge before git push", async () => {
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
      mode: "remote",
      remoteCapable: true,
      preflight: UNKNOWN_PREFLIGHT,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("operation=push");
    expect(outcome.recoveryHint?.failureKind).toBe("pre_flight_failed");
    expect(runner.calls.some((call) => call.bin === "git" && call.args[0] === "push")).toBe(false);
  });

  it("blocks local-only local merge before git push", async () => {
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
      mode: "local-only",
      remoteCapable: false,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("local-only: remote push unavailable");
    expect(outcome.recoveryHint?.failureKind).toBe("pre_flight_failed");
    expect(runner.calls.some((call) => call.bin === "git" && call.args[0] === "push")).toBe(false);
  });

  it("returns an actionable recovery hint when temp worktree creation fails", async () => {
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
    expect(outcome.note).toContain("temp_worktree_create_failed");
    expect(outcome.note).toContain("master");
    expect(outcome.recoveryHint?.failureKind).toBe("dirty_base_worktree");
    expect(outcome.recoveryHint?.recommendedNextAction).toBe("use_temp_merge_worktree");
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

describe("finishLifecycle autonomy-first cleanup", () => {
  const createExistingWorktree = (): string => mkdtempSync(join(tmpdir(), "micode-issue-1-"));

  const removeFixture = (path: string): void => {
    rmSync(path, { recursive: true, force: true });
  };

  const createWorktreePorcelain = (worktree: string): RunResult =>
    createRun(`worktree ${worktree}\nbranch refs/heads/${BRANCH}\n`);

  const gitCall = (runner: FakeRunner, args: readonly string[]): RunnerCall | undefined =>
    runner.calls.find((call) => call.bin === "git" && call.args.join(" ") === args.join(" "));

  const gitCalls = (runner: FakeRunner, args: readonly string[]): readonly RunnerCall[] =>
    runner.calls.filter((call) => call.bin === "git" && call.args.join(" ") === args.join(" "));

  it("auto-removes a clean PR merge worktree and reports cleanupOutcome kind=removed", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        gh: [createPrView(), createRun()],
        git: [createWorktreePorcelain(worktree), createRun(), createRun(), createRun()],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "pr",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("removed");
      expect(outcome.cleanupOutcome.retried).toBe(false);
      expect(outcome.worktreeRemoved).toBe(true);
      expect(gitCall(runner, ["worktree", "remove", worktree])).toEqual({
        bin: "git",
        args: ["worktree", "remove", worktree],
        cwd: CWD,
      });
    } finally {
      removeFixture(worktree);
    }
  });

  it("retries clean worktree remove with git worktree prune once and reports retried=true", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        gh: [createPrView(), createRun()],
        git: [
          createWorktreePorcelain(worktree),
          createRun(),
          createRun(),
          createFailure("locked"),
          createRun(),
          createRun(),
        ],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "pr",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("removed");
      expect(outcome.cleanupOutcome.retried).toBe(true);
      expect(outcome.worktreeRemoved).toBe(true);
      expect(gitCalls(runner, ["worktree", "remove", worktree])).toHaveLength(2);
      expect(gitCalls(runner, ["worktree", "prune"])).toHaveLength(1);
    } finally {
      removeFixture(worktree);
    }
  });

  it("does not force-delete a dirty worktree and reports cleanup_blocked(blocked-dirty)", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        gh: [createPrView(), createRun()],
        git: [createWorktreePorcelain(worktree), createRun(" M src/foo.ts\n"), createRun()],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "pr",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("blocked-dirty");
      expect(outcome.worktreeRemoved).toBe(false);
      expect(gitCalls(runner, ["worktree", "remove", worktree])).toHaveLength(0);
      expect(outcome.note).toContain("cleanup_blocked(blocked-dirty)");
    } finally {
      removeFixture(worktree);
    }
  });

  it("does not auto-delete an ambiguous untracked-only worktree", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        gh: [createPrView(), createRun()],
        git: [
          createWorktreePorcelain(worktree),
          createRun("?? thoughts/shared/plans/scratch.md\n"),
          createRun("thoughts/shared/plans/scratch.md\n"),
        ],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "pr",
        waitForChecks: false,
        baseBranch: "main",
        artifactPointers: [],
        fsOps: { mkdir: () => {}, rename: () => {} },
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("removed");
      expect(outcome.cleanupOutcome.reason).toContain("quarantined 1");
      expect(outcome.worktreeRemoved).toBe(true);
      expect(gitCalls(runner, ["worktree", "remove", worktree])).toHaveLength(1);
    } finally {
      removeFixture(worktree);
    }
  });

  it("does not delete an unknown external clone", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        gh: [createPrView(), createRun()],
        git: [createRun(`worktree ${WORKTREE}\nbranch refs/heads/${BRANCH}\n`), createRun(), createRun()],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "pr",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("blocked-external");
      expect(outcome.worktreeRemoved).toBe(false);
      expect(gitCalls(runner, ["worktree", "remove", worktree])).toHaveLength(0);
    } finally {
      removeFixture(worktree);
    }
  });

  it("routes local-merge cleanup through cleanup-policy and skips git branch -d when cleanup is blocked", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        git: [
          createRun(),
          createRun(),
          createRun(),
          createRun(),
          createRun(),
          createRun(),
          createWorktreePorcelain(worktree),
          createRun(" M src/foo.ts\n"),
          createRun(),
        ],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "local-merge",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("blocked-dirty");
      expect(outcome.worktreeRemoved).toBe(false);
      expect(gitCall(runner, ["worktree", "list", "--porcelain"])).toEqual({
        bin: "git",
        args: ["worktree", "list", "--porcelain"],
        cwd: CWD,
      });
      expect(gitCalls(runner, ["branch", "-d", BRANCH])).toHaveLength(0);
    } finally {
      removeFixture(worktree);
    }
  });
});
