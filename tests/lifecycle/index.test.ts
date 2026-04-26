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

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
  readonly edits: readonly string[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
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

const createRunner = (repoView = createRepoView()): FakeRunner => {
  const calls: RunnerCall[] = [];
  const edits: string[] = [];

  return {
    calls,
    edits,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);
      if (isArgs(args, ["rev-parse", "HEAD"])) return createRun(`${SHA}\n`);
      return createRun();
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      if (isArgs(args, ["repo", "view"])) return createRun(repoView);
      if (isArgs(args, ["issue", "create"])) return createRun(`${ISSUE_URL}\n`);
      if (isArgs(args, ["issue", "view"])) return createRun(JSON.stringify({ body: "## Context\n\nExisting body" }));
      if (isArgs(args, ["issue", "edit"])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
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
    const handle = createLifecycleStore({ runner: createRunner(), worktreesRoot, baseDir });

    expect(LIFECYCLE_STATES.ABORTED).toBe("aborted");
    expect(ARTIFACT_KINDS.WORKTREE).toBe("worktree");
    expect(Object.keys(handle).sort()).toEqual(["commit", "finish", "load", "recordArtifact", "setState", "start"]);
  });

  it("runs a full lifecycle with a fake runner", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });

    const started = await handle.start({
      summary: SUMMARY,
      goals: ["Track issue work"],
      constraints: ["Do not touch contract"],
      ownerLogin: OWNER,
      repo: REPO,
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

  it("enables issues on owned forks before opening issue", async () => {
    const runner = createRunner(createRepoView({ hasIssuesEnabled: false }));
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

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
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

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
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(record.notes.join("\n")).toContain("pre_flight_failed");
    expect(runner.calls.some((call) => isArgs(call.args, ["issue", "create"]))).toBe(false);
  });

  it("records artifacts idempotently", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    const record = await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);

    expect(record.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
  });

  it("sets lifecycle state through the handle", async () => {
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, baseDir });
    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

    const record = await handle.setState(started.issueNumber, LIFECYCLE_STATES.IN_DESIGN);

    expect(record.state).toBe(LIFECYCLE_STATES.IN_DESIGN);
  });

  it("returns null when loading a missing record", async () => {
    const handle = createLifecycleStore({ runner: createRunner(), worktreesRoot, baseDir });

    await expect(handle.load(404)).resolves.toBeNull();
  });
});
