import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_KINDS, createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const PREFIX = "micode-lifecycle-index-";
const OWNER = "Wuxie233";
const REPO = "micode";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ISSUE_NUMBER = 1;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const SHA = "abc123def456";
const PLAN_POINTER = "thoughts/shared/plans/issue-plan.md";
const SUMMARY = "Lifecycle workflow";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const MAIN_HEAD = "origin/main\n";
const MASTER_HEAD = "origin/master\n";
const DEVELOP_HEAD = "origin/develop\n";
const PR_CREATE_FAILED = "cannot create pr";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
  readonly edits: readonly string[];
}

interface RunnerOptions {
  readonly originHead?: string;
  readonly prCreate?: RunResult;
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE, stderr = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr,
  exitCode,
});

const createRepoView = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    nameWithOwner: `${OWNER}/${REPO}`,
    isFork: true,
    parent: { nameWithOwner: "vtemian/micode", url: "https://github.com/vtemian/micode" },
    owner: { login: OWNER },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
    ...overrides,
  });

const isArgs = (args: readonly string[], expected: readonly string[]): boolean => {
  return expected.every((value, index) => args[index] === value);
};

const createRunner = (repoView = createRepoView(), options: RunnerOptions = {}): FakeRunner => {
  const calls: RunnerCall[] = [];
  const edits: string[] = [];
  const originHead = options.originHead ?? MAIN_HEAD;

  return {
    calls,
    edits,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);
      if (isArgs(args, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) return createRun(originHead);
      if (isArgs(args, ["rev-parse", "HEAD"])) return createRun(`${SHA}\n`);
      return createRun();
    },
    gh: async (args, runOptions) => {
      calls.push({ bin: "gh", args, cwd: runOptions?.cwd });
      if (isArgs(args, ["repo", "view"])) return createRun(repoView);
      if (isArgs(args, ["issue", "create"])) return createRun(`${ISSUE_URL}\n`);
      if (isArgs(args, ["issue", "view"])) return createRun(JSON.stringify({ body: "## Context\n\nExisting body" }));
      if (isArgs(args, ["issue", "edit"])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
      if (isArgs(args, ["pr", "create"]) && options.prCreate) return options.prCreate;
      return createRun();
    },
  };
};

describe("lifecycle handle", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), `${PREFIX}worktrees-`));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("exposes factory methods and public constants", () => {
    const handle = createLifecycleStore({ runner: createRunner(), worktreesRoot, cwd: worktreesRoot, baseDir });

    expect(LIFECYCLE_STATES.ABORTED).toBe("aborted");
    expect(ARTIFACT_KINDS.WORKTREE).toBe("worktree");
    expect(Object.keys(handle).sort()).toEqual([
      "commit",
      "decideRecovery",
      "finish",
      "load",
      "recordArtifact",
      "recordExecutorEvent",
      "setState",
      "start",
    ]);
  });

  it("runs a full lifecycle with a fake runner", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });

    const started = await handle.start({
      summary: SUMMARY,
      goals: ["Track issue work"],
      constraints: ["Do not touch contract"],
    });
    const planned = await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    const committed = await handle.commit(started.issueNumber, {
      summary: "add lifecycle",
      scope: "lifecycle",
      push: true,
    });
    const finished = await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });
    const record = await handle.load(started.issueNumber);

    expect(planned.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
    expect(committed).toEqual({ committed: true, sha: SHA, pushed: true, retried: false, note: null });
    expect(finished).toEqual({
      merged: true,
      prUrl: null,
      closedAt: expect.any(Number),
      worktreeRemoved: true,
      note: null,
    });
    expect(record?.state).toBe(LIFECYCLE_STATES.CLEANED);
    expect(record?.artifacts[ARTIFACT_KINDS.COMMIT]).toEqual([SHA]);
    expect(runner.calls.some((call) => isArgs(call.args, ["issue", "close", "1"]))).toBe(true);
    expect(runner.edits.at(-1)).toContain("state: cleaned");
  });

  it("opens lifecycle finish PRs against the resolved master branch", async () => {
    const runner = createRunner(createRepoView(), { originHead: MASTER_HEAD });
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    await handle.finish(started.issueNumber, { mergeStrategy: "pr", waitForChecks: false });

    const opened = runner.calls.find((call) => call.bin === "gh" && isArgs(call.args, ["pr", "create"]));
    expect(opened?.args).toContain("--base");
    expect(opened?.args).toContain("master");
  });

  it("annotates failed lifecycle finish notes with the resolved develop branch", async () => {
    const runner = createRunner(createRepoView(), {
      originHead: DEVELOP_HEAD,
      prCreate: createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE, PR_CREATE_FAILED),
    });
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    const outcome = await handle.finish(started.issueNumber, { mergeStrategy: "pr", waitForChecks: false });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("resolved-base=develop(origin-head)");
    expect(outcome.note).toContain("gh_pr_create: cannot create pr");
  });

  it("enables issues on owned forks before opening issue", async () => {
    const runner = createRunner(createRepoView({ hasIssuesEnabled: false }));
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    expect(record.state).toBe(LIFECYCLE_STATES.BRANCH_READY);
    expect(
      runner.calls.some((call) => isArgs(call.args, ["repo", "edit", `${OWNER}/${REPO}`, "--enable-issues"])),
    ).toBe(true);
    expect(runner.calls.some((call) => isArgs(call.args, ["issue", "create"]))).toBe(true);
  });

  it("enables issues on owned repositories before opening issue", async () => {
    const runner = createRunner(
      createRepoView({ isFork: false, parent: null, viewerPermission: "ADMIN", hasIssuesEnabled: false }),
    );
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    expect(record.state).toBe(LIFECYCLE_STATES.BRANCH_READY);
    expect(
      runner.calls.some((call) => isArgs(call.args, ["repo", "edit", `${OWNER}/${REPO}`, "--enable-issues"])),
    ).toBe(true);
    expect(runner.calls.some((call) => isArgs(call.args, ["issue", "create"]))).toBe(true);
  });

  it("blocks unsafe upstream starts with an aborted record", async () => {
    const runner = createRunner(
      createRepoView({
        isFork: false,
        owner: { login: "vtemian" },
        viewerPermission: "READ",
        hasIssuesEnabled: true,
        parent: null,
      }),
    );
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(record.notes.join("\n")).toContain("pre_flight_failed");
    expect(runner.calls.some((call) => isArgs(call.args, ["issue", "create"]))).toBe(false);
  });

  it("records artifacts idempotently", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    const record = await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);

    expect(record.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
  });

  it("sets lifecycle state through the handle", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    const record = await handle.setState(started.issueNumber, LIFECYCLE_STATES.IN_DESIGN);

    expect(record.state).toBe(LIFECYCLE_STATES.IN_DESIGN);
  });

  it("returns null when loading a missing record", async () => {
    const handle = createLifecycleStore({ runner: createRunner(), worktreesRoot, cwd: worktreesRoot, baseDir });

    await expect(handle.load(404)).resolves.toBeNull();
  });

  it("uses input.cwd (not process.cwd()) when invoking ownership pre-flight", async () => {
    const customCwd = mkdtempSync(join(tmpdir(), `${PREFIX}cwd-`));
    try {
      const runner = createRunner();
      const handle = createLifecycleStore({ runner, worktreesRoot, cwd: customCwd, baseDir });

      await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

      const remoteCall = runner.calls.find(
        (call) => call.bin === "git" && call.args[0] === "remote" && call.args[1] === "get-url",
      );
      const repoCall = runner.calls.find(
        (call) => call.bin === "gh" && call.args[0] === "repo" && call.args[1] === "view",
      );
      expect(remoteCall).toBeDefined();
      expect(remoteCall?.cwd).toBe(customCwd);
      expect(repoCall).toBeDefined();
      expect(repoCall?.cwd).toBe(customCwd);
    } finally {
      rmSync(customCwd, { recursive: true, force: true });
    }
  });

  it("derives store baseDir from cwd when baseDir is not provided", async () => {
    const cwd = mkdtempSync(join(tmpdir(), `${PREFIX}cwd-default-`));
    try {
      const runner = createRunner();
      const handle = createLifecycleStore({ runner, worktreesRoot, cwd });

      const started = await handle.start({
        summary: SUMMARY,
        goals: [],
        constraints: [],
      });

      const reloaded = await handle.load(started.issueNumber);
      expect(reloaded?.issueNumber).toBe(started.issueNumber);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("places worktree under worktreesRoot, not inside cwd", async () => {
    const cwd = mkdtempSync(join(worktreesRoot, "repo-"));
    try {
      const runner = createRunner();
      const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });

      const started = await handle.start({
        summary: SUMMARY,
        goals: [],
        constraints: [],
      });

      expect(started.worktree.startsWith(join(worktreesRoot, "issue-"))).toBe(true);
      expect(started.worktree.startsWith(cwd)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns empty issueUrl when pre-flight reports UNKNOWN ownership", async () => {
    const runner: FakeRunner = {
      calls: [],
      edits: [],
      git: async () => createRun(EMPTY_OUTPUT),
      gh: async (args) => {
        if (isArgs(args, ["repo", "view"])) return createRun("not-json", FAILURE_EXIT_CODE);
        return createRun(EMPTY_OUTPUT);
      },
    };
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });

    const record = await handle.start({
      summary: SUMMARY,
      goals: [],
      constraints: [],
    });

    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(record.issueUrl).toBe("");
  });
});
