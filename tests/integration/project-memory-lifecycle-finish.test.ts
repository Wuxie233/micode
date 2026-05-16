import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { createProjectMemoryStore } from "@/project-memory";
import type { ScheduleMaintenanceInput } from "@/project-memory/maintenance/scheduler";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { resolveProjectId } from "@/utils/project-id";

const PREFIX = "micode-memory-lifecycle-";
const OWNER = "Wuxie233";
const REPO = "micode";
const REPO_NAME = `${OWNER}/${REPO}`;
const ORIGIN = `https://github.com/${REPO_NAME}.git`;
const ISSUE_NUMBER = 1;
const ISSUE_URL = `https://github.com/${REPO_NAME}/issues/${ISSUE_NUMBER}`;
const SHA = "abc123def456";
const SUMMARY = "Lifecycle memory finish";
const LEDGER_POINTER = join("thoughts", "ledgers", "CONTINUITY.md");
const LEDGER_QUERY = "durable";
const STATUS_ACTIVE = "active";
const COMMIT_SCOPE = "memory";
const COMMIT_SUMMARY = "record lifecycle memory";
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
const GIT_REV_PARSE = "rev-parse";
const GIT_HEAD = "HEAD";
const GH_CLOSE_ARGS = [GH_ISSUE, GH_CLOSE, String(ISSUE_NUMBER)] as const;

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
      if (isArgs(args, [GIT_REV_PARSE, GIT_HEAD])) return createRun(`${SHA}\n`);
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

afterEach(async () => {
  setMaintenanceFlags(originalMaintenanceEnabled, originalTerminalTriggerEnabled);
  await resetProjectMemoryRuntimeForTest();
  rmSync(root, { recursive: true, force: true });
});

async function useMemory() {
  const memory = createProjectMemoryStore({ dbDir: join(root, "memory") });
  await memory.initialize();
  setProjectMemoryStoreForTest(memory);
  return memory;
}

describe("project memory lifecycle finish E2E", () => {
  it("keeps lifecycle finish successful without auto-promoting lifecycle memory", async () => {
    const memory = await useMemory();
    const runner = createRunner();
    let schedulerInput: ScheduleMaintenanceInput | null = null;
    const scheduler: ProjectMemoryMaintenanceScheduler = async (input) => {
      schedulerInput = input;
      return { scheduled: true, note: null };
    };
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir, maintenanceScheduler: scheduler });
    const started = await handle.start({
      summary: SUMMARY,
      goals: ["Finish lifecycle without direct memory promotion"],
      constraints: ["Use temp memory store"],
      ownerLogin: OWNER,
      repo: REPO,
    });
    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.LEDGER, LEDGER_POINTER);

    const committed = await handle.commit(ISSUE_NUMBER, {
      scope: COMMIT_SCOPE,
      summary: COMMIT_SUMMARY,
      push: false,
    });
    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const identity = await resolveProjectId(cwd);
    const hits = await memory.searchEntries(identity.projectId, LEDGER_QUERY, { status: STATUS_ACTIVE, limit: 5 });
    const record = await handle.load(ISSUE_NUMBER);

    expect(committed).toEqual({ committed: true, sha: SHA, pushed: false, retried: false, note: null });
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
    expect(record?.artifacts[ARTIFACT_KINDS.COMMIT]).toEqual([SHA]);
    expect(record?.notes).toEqual([]);
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, GH_CLOSE_ARGS))).toBe(true);
    expect(runner.edits.at(-1)).toContain("state: cleaned");
    expect(hits).toEqual([]);
    expect(await memory.countEntries(identity.projectId)).toBe(0);
    expect(await memory.countSources(identity.projectId)).toBe(0);
    expect(schedulerInput).toEqual({
      reason: "terminal",
      triggeredBy: "lifecycle.finish",
      directory: cwd,
      sourcePointers: [
        "issue/1",
        expect.stringContaining("issue/1-"),
        LEDGER_POINTER,
        SHA,
        expect.stringContaining("/worktrees/issue-1-lifecycle-memory-finish"),
        "outcome/merged",
      ],
    });
  });
});
