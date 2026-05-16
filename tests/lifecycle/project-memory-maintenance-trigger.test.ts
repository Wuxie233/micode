import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { ARTIFACT_KINDS, createLifecycleStore, type ProjectMemoryMaintenanceScheduler } from "@/lifecycle";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { ScheduleMaintenanceInput, ScheduleMaintenanceOutcome } from "@/project-memory/maintenance/scheduler";
import { config } from "@/utils/config";

const PREFIX = "micode-lifecycle-maintenance-";
const OWNER = "Wuxie233";
const REPO = "micode";
const REPO_NAME = `${OWNER}/${REPO}`;
const ORIGIN = `https://github.com/${REPO_NAME}.git`;
const ISSUE_NUMBER = 1;
const ISSUE_URL = `https://github.com/${REPO_NAME}/issues/${ISSUE_NUMBER}`;
const PLAN_POINTER = "thoughts/shared/plans/issue-1.md";
const LEDGER_POINTER = "thoughts/ledgers/issue-1.md";
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
}

interface RunnerOptions {
  readonly failMerge?: boolean;
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createRepoView = (): string =>
  JSON.stringify({
    nameWithOwner: REPO_NAME,
    isFork: true,
    parent: { nameWithOwner: "vtemian/micode", url: "https://github.com/vtemian/micode" },
    owner: { login: OWNER },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
  });

const isArgs = (args: readonly string[], expected: readonly string[]): boolean => {
  return expected.every((value, index) => args[index] === value);
};

const createRunner = (options: RunnerOptions = {}): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, gitOptions) => {
      calls.push({ bin: "git", args, cwd: gitOptions?.cwd });
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);
      if (options.failMerge && isArgs(args, ["merge", "--no-ff"])) return createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE);
      return createRun();
    },
    gh: async (args, ghOptions) => {
      calls.push({ bin: "gh", args, cwd: ghOptions?.cwd });
      if (isArgs(args, ["repo", "view"])) return createRun(createRepoView());
      if (isArgs(args, ["issue", "create"])) return createRun(`${ISSUE_URL}\n`);
      if (isArgs(args, ["issue", "view"])) return createRun(JSON.stringify({ body: "## Context\n\nExisting body" }));
      return createRun();
    },
  };
};

const createMaintenanceScheduler = (
  implementation?: ProjectMemoryMaintenanceScheduler,
): ProjectMemoryMaintenanceScheduler => {
  return mock(
    implementation ??
      (async (): Promise<ScheduleMaintenanceOutcome> => ({ scheduled: true, reason: "scheduled", warnings: [] })),
  );
};

let root: string;
let cwd: string;
let baseDir: string;
let worktreesRoot: string;
let originalMaintenanceEnabled: boolean;
let originalTerminalTriggerEnabled: boolean;

function setMaintenanceFlags(enabled: boolean, terminalEnabled = enabled): void {
  (
    config.projectMemory as { maintenanceEnabled: boolean; maintenanceTerminalTriggerEnabled: boolean }
  ).maintenanceEnabled = enabled;
  (
    config.projectMemory as { maintenanceEnabled: boolean; maintenanceTerminalTriggerEnabled: boolean }
  ).maintenanceTerminalTriggerEnabled = terminalEnabled;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), PREFIX));
  cwd = join(root, "repo");
  baseDir = join(root, "records");
  worktreesRoot = join(root, "worktrees");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(worktreesRoot, { recursive: true });
  await $`git init -q`.cwd(cwd);
  await $`git remote add origin ${ORIGIN}`.cwd(cwd);
  originalMaintenanceEnabled = config.projectMemory.maintenanceEnabled;
  originalTerminalTriggerEnabled = config.projectMemory.maintenanceTerminalTriggerEnabled;
  setMaintenanceFlags(true, true);
});

afterEach(() => {
  setMaintenanceFlags(originalMaintenanceEnabled, originalTerminalTriggerEnabled);
  rmSync(root, { recursive: true, force: true });
});

async function startLifecycle(
  maintenanceScheduler: ProjectMemoryMaintenanceScheduler,
  runner: FakeRunner = createRunner(),
) {
  const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir, maintenanceScheduler });
  const started = await handle.start({ summary: "Lifecycle maintenance", goals: [], constraints: [] });
  await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
  await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.LEDGER, LEDGER_POINTER);
  return { handle, runner };
}

function scheduledInput(scheduler: ProjectMemoryMaintenanceScheduler): ScheduleMaintenanceInput {
  return (scheduler as unknown as { mock: { calls: [ScheduleMaintenanceInput][] } }).mock.calls[0][0];
}

describe("lifecycle terminal project-memory maintenance trigger", () => {
  it("schedules terminal maintenance once for merged finish with source pointers", async () => {
    const scheduler = createMaintenanceScheduler();
    const { handle } = await startLifecycle(scheduler);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const input = scheduledInput(scheduler);

    expect(outcome.merged).toBe(true);
    expect(scheduler).toHaveBeenCalledTimes(1);
    expect(input).toEqual({
      reason: "terminal",
      triggeredBy: "lifecycle.finish",
      directory: cwd,
      sourcePointers: [
        "issue/1",
        expect.stringContaining("issue/1-"),
        PLAN_POINTER,
        LEDGER_POINTER,
        expect.stringContaining("/worktrees/issue-1-lifecycle-maintenance"),
        "outcome/merged",
      ],
    });
  });

  it("keeps finish outcome successful when scheduler rejects", async () => {
    const scheduler = createMaintenanceScheduler(async () => {
      throw new Error("scheduler exploded");
    });
    const { handle } = await startLifecycle(scheduler);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(true);
    expect(scheduler).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when the terminal maintenance trigger flag is false", async () => {
    setMaintenanceFlags(true, false);
    const scheduler = createMaintenanceScheduler();
    const { handle } = await startLifecycle(scheduler);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(true);
    expect(scheduler).not.toHaveBeenCalled();
  });

  it("does not schedule non-merged non-blocked finish outcomes", async () => {
    const scheduler = createMaintenanceScheduler();
    const runner = createRunner({ failMerge: true });
    const { handle } = await startLifecycle(scheduler, runner);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(false);
    expect(scheduler).not.toHaveBeenCalled();
  });

  it("schedules terminal maintenance for executor-blocked terminal outcomes", async () => {
    const scheduler = createMaintenanceScheduler();
    const { handle } = await startLifecycle(scheduler);
    await handle.recordExecutorEvent({
      issueNumber: ISSUE_NUMBER,
      kind: JOURNAL_EVENT_KINDS.REVIEW_COMPLETED,
      taskId: "task-1",
      summary: "review blocked",
      reviewOutcome: "blocked",
    });

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const input = scheduledInput(scheduler);

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toBe("executor_blocked: task-1");
    expect(scheduler).toHaveBeenCalledTimes(1);
    expect(input.sourcePointers).toEqual([
      "issue/1",
      expect.stringContaining("issue/1-"),
      PLAN_POINTER,
      LEDGER_POINTER,
      expect.stringContaining("/worktrees/issue-1-lifecycle-maintenance"),
      "outcome/executor_blocked",
    ]);
  });
});
