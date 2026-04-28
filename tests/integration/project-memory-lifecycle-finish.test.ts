import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { ARTIFACT_KINDS, createLifecycleStore, LIFECYCLE_STATES, type LifecycleHandle } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { createProjectMemoryStore, type ProjectMemoryStore, type SearchHit } from "@/project-memory";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
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
const SOURCE_LIFECYCLE = "lifecycle";
const STATUS_ACTIVE = "active";
const COMMIT_SCOPE = "memory";
const COMMIT_SUMMARY = "record lifecycle memory";
const PROMOTED_NOTE = "memory_promoted";
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
const LEDGER_MARKDOWN = [
  "## Decisions",
  "- Finish promotion creates durable lifecycle memory",
  "## Lessons",
  "- Lifecycle finish keeps normal cleanup successful",
].join("\n");

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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), PREFIX));
  cwd = join(root, "repo");
  baseDir = join(root, "records");
  worktreesRoot = join(root, "worktrees");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(worktreesRoot, { recursive: true });
  await $`git init -q`.cwd(cwd);
  await $`git remote add origin ${ORIGIN}`.cwd(cwd);
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  rmSync(root, { recursive: true, force: true });
});

async function useMemory(): Promise<ProjectMemoryStore> {
  const memory = createProjectMemoryStore({ dbDir: join(root, "memory") });
  await memory.initialize();
  setProjectMemoryStoreForTest(memory);
  return memory;
}

function writeLedger(): string {
  const directory = join(cwd, "thoughts", "ledgers");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(cwd, LEDGER_POINTER), LEDGER_MARKDOWN);
  return LEDGER_POINTER;
}

async function startWithLedger(handle: LifecycleHandle): Promise<void> {
  const started = await handle.start({
    summary: SUMMARY,
    goals: ["Persist lifecycle memory"],
    constraints: ["Use temp memory store"],
    ownerLogin: OWNER,
    repo: REPO,
  });
  await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.LEDGER, writeLedger());
}

async function hasActiveLifecycleSource(
  memory: ProjectMemoryStore,
  projectId: string,
  hits: readonly SearchHit[],
): Promise<boolean> {
  for (const hit of hits) {
    if (hit.entry.status !== STATUS_ACTIVE) continue;
    const sources = await memory.loadSourcesForEntry(projectId, hit.entry.id);
    if (sources.some((source) => source.kind === SOURCE_LIFECYCLE)) return true;
  }
  return false;
}

describe("project memory lifecycle finish E2E", () => {
  it("keeps lifecycle finish successful while promoting active lifecycle memory", async () => {
    const memory = await useMemory();
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });
    await startWithLedger(handle);

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
      note: null,
    });
    expect(record?.state).toBe(LIFECYCLE_STATES.CLEANED);
    expect(record?.artifacts[ARTIFACT_KINDS.COMMIT]).toEqual([SHA]);
    expect(record?.notes.some((note) => note.startsWith(PROMOTED_NOTE))).toBe(true);
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, GH_CLOSE_ARGS))).toBe(true);
    expect(runner.edits.at(-1)).toContain("state: cleaned");
    expect(hits.length).toBeGreaterThan(0);
    expect(await hasActiveLifecycleSource(memory, identity.projectId, hits)).toBe(true);
  });
});
