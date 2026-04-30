import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { ARTIFACT_KINDS, createLifecycleStore, type LifecycleHandle } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const PREFIX = "micode-lifecycle-promote-";
const OWNER = "Wuxie233";
const REPO = "micode";
const ORIGIN = "https://github.com/Wuxie233/micode.git";
const ISSUE_NUMBER = 1;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const LEDGER_POINTER = join("thoughts", "ledgers", "CONTINUITY.md");
const ISSUE_POINTER = "issue/1";
const PROMOTION_FAILURE = "promotion write failed";
const ISSUE_REQUEST_SUMMARY = "Improve project memory promotion quality so issue bodies become useful entries.";
const ISSUE_GOAL_SUMMARIES = [
  "Parse lifecycle sections deterministically",
  "Avoid collapsing the body into a single ## Request note",
] as const;
const ISSUE_CONSTRAINT_SUMMARIES = ["Keep promotion best-effort and non-blocking"] as const;
const EXPECTED_ISSUE_NOTE_SUMMARIES = [
  ISSUE_REQUEST_SUMMARY,
  ...ISSUE_GOAL_SUMMARIES,
  ...ISSUE_CONSTRAINT_SUMMARIES,
] as const;
const ISSUE_BODY_SEARCH_LIMIT = 20;
const LIFECYCLE_PROMOTE_TEST_TIMEOUT_MS = 20_000;
const LEDGER_MARKDOWN = [
  "## Decisions",
  "- Promote ledger decision after local merge",
  "## Lessons",
  "- Ledger markdown is preferred over issue body",
].join("\n");
const ISSUE_BODY = "## Decisions\n- Issue body fallback should not win\n";

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
  readonly failMerge?: boolean;
  readonly issueBody?: string;
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createRepoView = (): string =>
  JSON.stringify({
    nameWithOwner: `${OWNER}/${REPO}`,
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
  const edits: string[] = [];

  return {
    calls,
    edits,
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
      if (isArgs(args, ["issue", "view"])) return createRun(JSON.stringify({ body: options.issueBody ?? ISSUE_BODY }));
      if (isArgs(args, ["issue", "edit"])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
      return createRun();
    },
  };
};

const createFailingStore = (): ProjectMemoryStore => ({
  initialize: async () => {},
  upsertEntity: async () => {
    throw new Error(PROMOTION_FAILURE);
  },
  upsertEntry: async () => {},
  upsertRelation: async () => {},
  upsertSource: async () => {},
  loadEntity: async () => null,
  loadEntry: async () => null,
  loadSourcesForEntry: async () => [],
  searchEntries: async () => [],
  countEntities: async () => 0,
  countEntries: async () => 0,
  countEntriesByStatus: async () => ({ active: 0, superseded: 0, tentative: 0, hypothesis: 0, deprecated: 0 }),
  countSources: async () => 0,
  countMissingSources: async () => 0,
  countStaleEntries: async () => 0,
  forgetEntry: async () => {},
  forgetEntity: async () => {},
  forgetSource: async () => {},
  forgetProject: async () => {},
  close: async () => {},
});

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

function writeLedger(markdown: string): string {
  const directory = join(cwd, "thoughts", "ledgers");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(cwd, LEDGER_POINTER), markdown);
  return LEDGER_POINTER;
}

async function startWithLedger(handle: LifecycleHandle, markdown = LEDGER_MARKDOWN): Promise<void> {
  const started = await handle.start({
    summary: "Lifecycle memory",
    goals: [],
    constraints: [],
    ownerLogin: OWNER,
    repo: REPO,
  });
  await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.LEDGER, writeLedger(markdown));
}

describe("lifecycle finish project-memory promotion", () => {
  it(
    "promotes merged lifecycle ledger entries as active lifecycle sources",
    async () => {
      const memory = await useMemory();
      const runner = createRunner();
      const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });
      await startWithLedger(handle);

      const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
      const identity = await resolveProjectId(cwd);
      const hits = await memory.searchEntries(identity.projectId, "ledger", { status: "active", limit: 5 });
      const sources = await memory.loadSourcesForEntry(identity.projectId, hits[0]?.entry.id ?? EMPTY_OUTPUT);
      const record = await handle.load(ISSUE_NUMBER);

      expect(outcome.merged).toBe(true);
      expect(await memory.countEntries(identity.projectId)).toBe(2);
      expect(hits[0]?.entry.status).toBe("active");
      expect(sources[0]?.kind).toBe("lifecycle");
      expect(sources[0]?.pointer).toBe(ISSUE_POINTER);
      expect(record?.notes).toContain("memory_promoted: 2 entries");
    },
    LIFECYCLE_PROMOTE_TEST_TIMEOUT_MS,
  );

  it(
    "promotes lifecycle issue body sections as meaningful notes when no ledger exists",
    async () => {
      const issueBody = [
        "## Request",
        "",
        ISSUE_REQUEST_SUMMARY,
        "",
        "## Goals",
        "",
        ...ISSUE_GOAL_SUMMARIES.map((summary) => `- ${summary}`),
        "",
        "## Constraints",
        "",
        ...ISSUE_CONSTRAINT_SUMMARIES.map((summary) => `- ${summary}`),
      ].join("\n");
      const memory = await useMemory();
      const runner = createRunner({ issueBody });
      const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });
      await handle.start({
        summary: "Lifecycle memory",
        goals: [],
        constraints: [],
        ownerLogin: OWNER,
        repo: REPO,
      });

      const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
      const identity = await resolveProjectId(cwd);
      const found = await Promise.all(
        EXPECTED_ISSUE_NOTE_SUMMARIES.map(async (summary) => {
          const hits = await memory.searchEntries(identity.projectId, summary, {
            status: "active",
            type: "note",
            limit: ISSUE_BODY_SEARCH_LIMIT,
          });
          return hits.find((hit) => hit.entry.summary === summary)?.entry;
        }),
      );
      const entries = found.flatMap((entry) => (entry ? [entry] : []));
      const titles = entries.map((entry) => entry.title);
      const summaries = entries.map((entry) => entry.summary);

      expect(outcome.merged).toBe(true);
      expect(await memory.countEntries(identity.projectId)).toBe(EXPECTED_ISSUE_NOTE_SUMMARIES.length);
      expect(entries).toHaveLength(EXPECTED_ISSUE_NOTE_SUMMARIES.length);
      expect(entries.every((entry) => entry.type === "note")).toBe(true);
      expect(titles.every((title) => !title.startsWith("#"))).toBe(true);
      expect(titles[0]).toBe(ISSUE_REQUEST_SUMMARY);
      expect(titles).toEqual(EXPECTED_ISSUE_NOTE_SUMMARIES);
      expect(summaries).toEqual(EXPECTED_ISSUE_NOTE_SUMMARIES);
    },
    LIFECYCLE_PROMOTE_TEST_TIMEOUT_MS,
  );

  it("skips promotion for non-merged finish outcomes", async () => {
    const memory = await useMemory();
    const runner = createRunner({ failMerge: true });
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });
    await startWithLedger(handle);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const identity = await resolveProjectId(cwd);
    const record = await handle.load(ISSUE_NUMBER);

    expect(outcome.merged).toBe(false);
    expect(await memory.countEntries(identity.projectId)).toBe(0);
    expect(record?.notes.some((note) => note.startsWith("memory_"))).toBe(false);
  });

  it("keeps merged finish outcomes when promotion fails", async () => {
    setProjectMemoryStoreForTest(createFailingStore());
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd, baseDir });
    await startWithLedger(handle);

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const record = await handle.load(ISSUE_NUMBER);

    expect(outcome.merged).toBe(true);
    expect(record?.notes).toContain(`memory_promotion_failed: ${PROMOTION_FAILURE}`);
  });
});
