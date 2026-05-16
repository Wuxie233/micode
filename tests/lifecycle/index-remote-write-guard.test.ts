import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_KINDS, createLifecycleStore, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle";
import { REMOTE_WRITE_BLOCKED_NOTE } from "@/lifecycle/remote-write-guard";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const PREFIX = "micode-lifecycle-index-remote-write-guard-";
const ISSUE_NUMBER = 90;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/90";
const BRANCH = "issue/90-remote-write-guard";
const WORKTREE = "/tmp/micode-issue-90";
const CWD = "/tmp/micode";
const UNKNOWN_ORIGIN = "not-a-github-url";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

const createRun = (stdout = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode: OK_EXIT_CODE,
});

const createUnknownOriginRunner = (): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
        return createRun(`${UNKNOWN_ORIGIN}\n`);
      }
      return createRun();
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return createRun();
    },
  };
};

const createRecord = (): LifecycleRecord => ({
  issueNumber: ISSUE_NUMBER,
  issueUrl: ISSUE_URL,
  branch: BRANCH,
  worktree: WORKTREE,
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [WORKTREE],
  },
  notes: [],
  updatedAt: Date.now(),
});

const seedRecord = async (baseDir: string): Promise<void> => {
  await Bun.write(join(baseDir, `${ISSUE_NUMBER}.json`), JSON.stringify(createRecord(), null, 2));
};

const hasCall = (runner: FakeRunner, bin: "git" | "gh", command: readonly string[]): boolean =>
  runner.calls.some((call) => call.bin === bin && command.every((value, index) => call.args[index] === value));

describe("lifecycle remote write guard integration", () => {
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

  it("blocks lifecycle commit before local commit, push, or issue sync", async () => {
    await seedRecord(baseDir);
    const runner = createUnknownOriginRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: CWD, baseDir });

    const outcome = await handle.commit(ISSUE_NUMBER, {
      scope: "lifecycle",
      summary: "guard remote writes",
      push: false,
    });

    expect(outcome).toMatchObject({
      committed: false,
      sha: null,
      pushed: false,
      retried: false,
      note: REMOTE_WRITE_BLOCKED_NOTE,
    });
    expect(outcome.recoveryHint).toMatchObject({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      safeToRetry: false,
      issueNumber: ISSUE_NUMBER,
      branch: BRANCH,
      worktree: WORKTREE,
    });
    expect(runner.calls).toEqual([{ bin: "git", args: ["remote", "get-url", "origin"], cwd: WORKTREE }]);
    expect(hasCall(runner, "git", ["add", "--all"])).toBe(false);
    expect(hasCall(runner, "git", ["commit"])).toBe(false);
    expect(hasCall(runner, "git", ["push"])).toBe(false);
    expect(hasCall(runner, "gh", ["issue", "edit"])).toBe(false);
  });

  it("blocks lifecycle finish before PR, issue, or push remote mutations", async () => {
    await seedRecord(baseDir);
    const runner = createUnknownOriginRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: CWD, baseDir });

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "pr", waitForChecks: false });

    expect(outcome).toMatchObject({
      merged: false,
      prUrl: null,
      closedAt: null,
      worktreeRemoved: false,
      cleanupOutcome: { kind: "failed", reason: "remote write blocked before mutation", retried: false },
      note: REMOTE_WRITE_BLOCKED_NOTE,
    });
    expect(outcome.recoveryHint).toMatchObject({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      safeToRetry: false,
      issueNumber: ISSUE_NUMBER,
      branch: BRANCH,
      worktree: WORKTREE,
    });
    expect(runner.calls).toEqual([{ bin: "git", args: ["remote", "get-url", "origin"], cwd: CWD }]);
    expect(hasCall(runner, "gh", ["pr", "create"])).toBe(false);
    expect(hasCall(runner, "gh", ["pr", "merge"])).toBe(false);
    expect(hasCall(runner, "gh", ["pr", "comment"])).toBe(false);
    expect(hasCall(runner, "gh", ["issue", "edit"])).toBe(false);
    expect(hasCall(runner, "gh", ["issue", "close"])).toBe(false);
    expect(hasCall(runner, "git", ["push"])).toBe(false);
  });
});
