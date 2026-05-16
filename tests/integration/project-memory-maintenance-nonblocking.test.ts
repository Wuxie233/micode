import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import {
  ARTIFACT_KINDS,
  createLifecycleStore,
  LIFECYCLE_STATES,
  type ProjectMemoryMaintenanceScheduler,
} from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { ScheduleMaintenanceInput, ScheduleMaintenanceOutcome } from "@/project-memory/maintenance/scheduler";
import { config } from "@/utils/config";

const PREFIX = "micode-maintenance-nonblocking-";
const OWNER = "Wuxie233";
const REPO = "micode";
const REPO_NAME = `${OWNER}/${REPO}`;
const ORIGIN = `https://github.com/${REPO_NAME}.git`;
const ISSUE_NUMBER = 1;
const ISSUE_URL = `https://github.com/${REPO_NAME}/issues/${ISSUE_NUMBER}`;
const SUMMARY = "Lifecycle maintenance nonblocking";
const PLAN_POINTER = "thoughts/shared/plans/issue-1.md";
const LEDGER_POINTER = "thoughts/ledgers/issue-1.md";
const SHA = "abc123def456";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const GH_ISSUE = "issue";
const GH_REPO = "repo";
const GH_CREATE = "create";
const GH_CLOSE = "close";
const GH_VIEW = "view";
const GH_EDIT = "edit";
const GIT_REMOTE = "remote";
const GIT_GET_URL = "get-url";
const GIT_ORIGIN = "origin";
const GH_CLOSE_ARGS = [GH_ISSUE, GH_CLOSE, String(ISSUE_NUMBER)] as const;
const SCHEDULER_ERROR = "scheduler exploded";
const WARNING_MARKER = "lifecycle.project-memory-maintenance";

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

const createRunner = (): FakeRunner => {
  const calls: RunnerCall[] = [];
  const edits: string[] = [];

  return {
    calls,
    edits,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (isArgs(args, [GIT_REMOTE, GIT_GET_URL, GIT_ORIGIN])) return createRun(`${ORIGIN}\n`);
      if (isArgs(args, ["rev-parse", "HEAD"])) return createRun(`${SHA}\n`);
      return createRun();
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      if (isArgs(args, [GH_REPO, GH_VIEW])) return createRun(createRepoView());
      if (isArgs(args, [GH_ISSUE, GH_CREATE])) return createRun(`${ISSUE_URL}\n`);
      if (isArgs(args, [GH_ISSUE, GH_VIEW])) return createRun(JSON.stringify({ body: "## Context\n\nExisting body" }));
      if (isArgs(args, [GH_ISSUE, GH_EDIT])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
      return createRun();
    },
  };
};

const createRejectingScheduler = (): ProjectMemoryMaintenanceScheduler => {
  return mock(async (_input: ScheduleMaintenanceInput): Promise<ScheduleMaintenanceOutcome> => {
    throw new Error(SCHEDULER_ERROR);
  });
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

function scheduledInput(scheduler: ProjectMemoryMaintenanceScheduler): ScheduleMaintenanceInput {
  return (scheduler as unknown as { mock: { calls: [ScheduleMaintenanceInput][] } }).mock.calls[0][0];
}

describe("project memory maintenance nonblocking finish integration", () => {
  it("keeps lifecycle finish merged, closed, and cleaned when terminal maintenance rejects", async () => {
    const runner = createRunner();
    const scheduler = createRejectingScheduler();
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir, maintenanceScheduler: scheduler });
    const started = await handle.start({ summary: SUMMARY, goals: ["finish lifecycle"], constraints: [] });
    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.LEDGER, LEDGER_POINTER);

    let thrown: unknown = null;
    const outcome = await handle
      .finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false })
      .catch((error) => {
        thrown = error;
        return null;
      });
    const record = await handle.load(ISSUE_NUMBER);
    const input = scheduledInput(scheduler);

    expect(thrown).toBeNull();
    expect(outcome).toEqual({
      merged: true,
      prUrl: null,
      closedAt: expect.any(Number),
      worktreeRemoved: true,
      cleanupOutcome: expect.objectContaining({
        kind: "already-missing",
        retried: false,
      }),
      note: null,
    });
    expect(record?.state).toBe(LIFECYCLE_STATES.CLEANED);
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, GH_CLOSE_ARGS))).toBe(true);
    expect(runner.edits.at(-1)).toContain("state: cleaned");
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
        expect.stringContaining("/worktrees/issue-1-lifecycle-maintenance-nonblocking"),
        "outcome/merged",
      ],
    });
    expect(warnSpy).toHaveBeenCalledWith(`[${WARNING_MARKER}] schedule failed: ${SCHEDULER_ERROR}`);
    warnSpy.mockRestore();
  });
});
