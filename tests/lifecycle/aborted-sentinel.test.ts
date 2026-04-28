import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_KINDS, createLifecycleStore as createLifecycleHandle, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { createLifecycleStore as createJsonLifecycleStore } from "@/lifecycle/store";
import type { LifecycleRecord } from "@/lifecycle/types";

const PREFIX = "micode-lifecycle-aborted-sentinel-";
const OWNER = "Wuxie233";
const REPO = "micode";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ISSUE_ONE = 1;
const SENTINEL_ISSUE = Number.MAX_SAFE_INTEGER;
const SUMMARY = "Lifecycle workflow";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const UPDATED_AT = 1_776_000_000_000;
const REAL_NOTE = "real issue one";
const SENTINEL_NOTE = "aborted-sentinel:max";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createUpstreamView = (): string =>
  JSON.stringify({
    nameWithOwner: `${OWNER}/${REPO}`,
    isFork: false,
    parent: null,
    owner: { login: "vtemian" },
    viewerPermission: "READ",
    hasIssuesEnabled: true,
  });

const isArgs = (args: readonly string[], expected: readonly string[]): boolean => {
  return expected.every((value, index) => args[index] === value);
};

const createRunner = (): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);
      return createRun();
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      if (isArgs(args, ["repo", "view"])) return createRun(createUpstreamView());
      return createRun();
    },
  };
};

const createRecord = (issueNumber = ISSUE_ONE): LifecycleRecord => ({
  issueNumber,
  issueUrl: `https://github.com/${OWNER}/${REPO}/issues/${issueNumber}`,
  branch: `issue/${issueNumber}-real`,
  worktree: `/tmp/micode-issue-${issueNumber}`,
  state: LIFECYCLE_STATES.PROPOSED,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [REAL_NOTE],
  updatedAt: UPDATED_AT,
});

describe("lifecycle aborted sentinel", () => {
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

  it("aborted records use a sentinel issue number that cannot collide with real issues", async () => {
    const handle = createLifecycleHandle({ runner: createRunner(), worktreesRoot, cwd: worktreesRoot, baseDir });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(record.issueNumber).toBe(SENTINEL_ISSUE);
    expect(record.notes).toContain(SENTINEL_NOTE);
  });

  it("aborting does not overwrite a pre-existing real issue #1 record", async () => {
    const store = createJsonLifecycleStore({ baseDir });
    const seeded = createRecord();
    const handle = createLifecycleHandle({ runner: createRunner(), worktreesRoot, cwd: worktreesRoot, baseDir });

    await store.save(seeded);
    await handle.start({ summary: SUMMARY, goals: [], constraints: [], ownerLogin: OWNER, repo: REPO });

    await expect(handle.load(ISSUE_ONE)).resolves.toEqual(seeded);
  });
});
