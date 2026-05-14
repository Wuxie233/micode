import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import type { LifecycleHandle, LifecycleRecord } from "@/lifecycle";
import { ARTIFACT_KINDS, createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { parseLifecycleRecord } from "@/lifecycle/schemas";
import { createLifecycleTools } from "@/tools/lifecycle";

const PREFIX = "throwaway-repo-";
const LIFECYCLE_PREFIX = "throwaway-lifecycle-";
const WORKTREE_PREFIX = "throwaway-worktrees-";
const OWNER = "Wuxie233";
const REPO = "micode";
const REPO_NAME = `${OWNER}/${REPO}`;
const ORIGIN = `git@github.com:${REPO_NAME}.git`;
const ISSUE_NUMBER = 1;
const ISSUE_URL = `https://github.com/${REPO_NAME}/issues/${ISSUE_NUMBER}`;
const SUMMARY = "Lifecycle scripted workflow";
const MAIN_BRANCH = "main";
const README_FILE = "README.md";
const INITIAL_COMMIT = "chore: initial";
const FIRST_SHA = "abc1231";
const SECOND_SHA = "abc1232";
const FIRST_SCOPE = "batch-one";
const SECOND_SCOPE = "batch-two";
const FIRST_SUMMARY = "apply first batch";
const SECOND_SUMMARY = "apply second batch";
const FIRST_MESSAGE = `chore(${FIRST_SCOPE}): ${FIRST_SUMMARY} (#${ISSUE_NUMBER})`;
const SECOND_MESSAGE = `chore(${SECOND_SCOPE}): ${SECOND_SUMMARY} (#${ISSUE_NUMBER})`;
const SHA = "abc123def456";
const DESIGN_POINTER = "thoughts/shared/designs/issue-1-design.md";
const PLAN_POINTER = "thoughts/shared/plans/issue-1-plan.md";
const TOOL_CONTEXT = {} as unknown as ToolContext;
const OK_EXIT_CODE = 0;
const EMPTY_OUTPUT = "";
const NO_CALLS = 0;
const COMMIT_COUNT = 2;
const LINE_BREAK = "\n";
const FORCE_FLAG = "--force";
const HISTORY_FORMAT = "--format=%s";
const GH_DEFAULT_BRANCH_ARGS = ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"] as const;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
  readonly edits: readonly string[];
}

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

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

const isPush = (args: readonly string[]): boolean => args[0] === "push";

const fakeShaFor = (args: readonly string[]): string => {
  const message = args[2] ?? EMPTY_OUTPUT;
  if (message.startsWith(`chore(${FIRST_SCOPE})`)) return FIRST_SHA;
  if (message.startsWith(`chore(${SECOND_SCOPE})`)) return SECOND_SHA;
  return SHA;
};

const runGit = async (args: readonly string[], cwd: string): Promise<RunResult> => {
  const tokens = [...args];
  const completed = await $`git ${tokens}`.cwd(cwd).quiet().nothrow();

  return {
    stdout: completed.stdout.toString(),
    stderr: completed.stderr.toString(),
    exitCode: completed.exitCode,
  };
};

const syncFakeWorktreeReadme = async (cwd?: string): Promise<void> => {
  if (!cwd || cwd === process.cwd()) return;
  const source = join(cwd, README_FILE);
  if (!existsSync(source)) return;
  await Bun.write(join(process.cwd(), README_FILE), await Bun.file(source).text());
};

const requireGit = async (args: readonly string[], cwd: string): Promise<void> => {
  const completed = await runGit(args, cwd);
  if (completed.exitCode === OK_EXIT_CODE) return;

  throw new Error(`git ${args.join(" ")} failed: ${completed.stderr}${completed.stdout}`);
};

const createRunner = (repo: string): FakeRunner => {
  const calls: RunnerCall[] = [];
  const edits: string[] = [];
  let headSha = SHA;
  let lifecycleWorktree: string | null = null;

  return {
    calls,
    edits,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });

      // lifecycle_commit push path is mocked to avoid touching any remote.
      if (isPush(args)) return createRun();

      // finishViaLocalMerge reads HEAD for the commit artifact table.
      if (args[0] === "rev-parse" && args[1] === "HEAD") return createRun(`${headSha}${LINE_BREAK}`);

      // origin URL ownership/lifecycle record preflight reads the target remote.
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}${LINE_BREAK}`);

      // lifecycle_start_request creates the issue worktree; mirror README into a real git repo for commits.
      if (args[0] === "worktree" && args[1] === "add" && args.includes("-b")) {
        const worktree = args.at(-1);
        if (worktree) {
          lifecycleWorktree = worktree;
          mkdirSync(worktree, { recursive: true });
          await Bun.write(join(worktree, README_FILE), await Bun.file(join(repo, README_FILE)).text());
          await requireGit(["init", "--initial-branch", MAIN_BRANCH], worktree);
          await requireGit(["config", "user.name", "Micode Test"], worktree);
          await requireGit(["config", "user.email", "micode@example.invalid"], worktree);
          await requireGit(["add", README_FILE], worktree);
          await requireGit(["commit", "-m", INITIAL_COMMIT], worktree);
        }
        return createRun();
      }

      // lifecycle_commit stages worktree changes before creating the lifecycle commit.
      if (isArgs(args, ["add", "--all"])) return runGit(args, options?.cwd ?? repo);

      // lifecycle_commit writes real commits so history assertions cover both batch subjects.
      if (args[0] === "commit") {
        const completed = await runGit(args, options?.cwd ?? repo);
        await syncFakeWorktreeReadme(options?.cwd);
        headSha = fakeShaFor(args);
        return completed;
      }

      // lifecycle_commit reads changed paths for pre-push hooks; no hook paths needed in this test.
      if (args[0] === "diff-tree") return createRun();

      // finish default-branch resolver probes origin/HEAD before falling back to gh metadata.
      if (isArgs(args, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))
        return createRun(`${MAIN_BRANCH}${LINE_BREAK}`);

      // temp merge worktree create path is mocked to keep the test filesystem deterministic.
      if (args[0] === "worktree" && args[1] === "add") return createRun();

      // lifecycle cleanup removes the fake issue worktree directory from disk for assertions.
      if (args[0] === "worktree" && args[1] === "remove") {
        const worktree = args.filter((arg) => arg !== FORCE_FLAG).at(-1);
        if (worktree && worktree !== repo) rmSync(worktree, { recursive: true, force: true });
        return createRun();
      }

      // temp merge worktree list path is mocked for cleanup discovery.
      if (args[0] === "worktree" && args[1] === "list") {
        const worktrees = [repo, lifecycleWorktree].filter((path): path is string => path !== null);
        return createRun(worktrees.map((path) => `worktree ${path}`).join(LINE_BREAK));
      }

      // temp merge worktree prune path is mocked for post-cleanup maintenance.
      if (args[0] === "worktree" && args[1] === "prune") return createRun();

      // finishViaLocalMerge fetch path is mocked to avoid network access.
      if (args[0] === "fetch") return createRun();

      // finishViaLocalMerge fast-forward merge probe is mocked as successful.
      if (args[0] === "merge" && args.includes("--ff-only")) return createRun();

      // finishViaLocalMerge no-fast-forward merge path is mocked as successful.
      if (args[0] === "merge" && args.includes("--no-ff")) {
        await requireGit(["add", README_FILE], repo);
        await requireGit(["commit", "-m", FIRST_MESSAGE], repo);
        await requireGit(["commit", "--allow-empty", "-m", SECOND_MESSAGE], repo);
        return createRun();
      }

      // branch cleanup path is mocked after the lifecycle worktree is removed.
      if (args[0] === "branch" && args.includes("-d")) return createRun();

      // status cleanliness checks are mocked as clean porcelain output.
      if (isArgs(args, ["status", "--porcelain"])) return createRun();

      // cleanup untracked checks are mocked with an empty tracked-file list.
      if (args[0] === "ls-files") return createRun();

      console.warn(`[lifecycle-e2e-fake-runner] unhandled git command: ${args.join(" ")}`);
      return runGit(args, options?.cwd ?? repo);
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      if (isArgs(args, GH_DEFAULT_BRANCH_ARGS)) return createRun(`${MAIN_BRANCH}${LINE_BREAK}`);
      if (isArgs(args, ["repo", "view"])) return createRun(createRepoView());
      if (isArgs(args, ["issue", "create"])) return createRun(`${ISSUE_URL}${LINE_BREAK}`);
      if (isArgs(args, ["issue", "view"])) return createRun(JSON.stringify({ body: "## Context\n\nExisting body" }));
      if (isArgs(args, ["issue", "edit"])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
      return createRun();
    },
  };
};

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

const executeTool = async (toolDef: ToolDefinition, args: Record<string, unknown>): Promise<string> => {
  const execute = toolDef.execute.bind(toolDef) as ExecuteSignature;
  return stringify(await execute(args, TOOL_CONTEXT));
};

const initializeRepo = async (repo: string): Promise<void> => {
  await requireGit(["init", "--initial-branch", MAIN_BRANCH], repo);
  await requireGit(["config", "user.name", "Micode Test"], repo);
  await requireGit(["config", "user.email", "micode@example.invalid"], repo);
  await requireGit(["config", "merge.autoEdit", "false"], repo);
  await Bun.write(join(repo, README_FILE), `# ${REPO}${LINE_BREAK}`);
  await requireGit(["add", README_FILE], repo);
  await requireGit(["commit", "-m", INITIAL_COMMIT], repo);
  await requireGit(["remote", "add", "origin", ORIGIN], repo);
};

const loadRecord = async (handle: LifecycleHandle, issueNumber: number): Promise<LifecycleRecord> => {
  const record = await handle.load(issueNumber);
  if (record) return record;
  throw new Error(`Lifecycle record not found: ${issueNumber}`);
};

const readRecord = async (location: string): Promise<LifecycleRecord> => {
  const raw: unknown = JSON.parse(await Bun.file(location).text());
  const parsed = parseLifecycleRecord(raw);
  if (parsed.ok) return parsed.record;
  throw new Error(parsed.issues.join(LINE_BREAK));
};

const writeBatch = async (worktree: string, label: string): Promise<void> => {
  await Bun.write(join(worktree, README_FILE), `# ${REPO}${LINE_BREAK}${label}${LINE_BREAK}`);
};

const getSubjects = (stdout: string): readonly string[] => {
  return stdout
    .trim()
    .split(LINE_BREAK)
    .filter((subject) => subject.length > 0);
};

const getLifecycleSubjects = (stdout: string): readonly string[] => {
  return getSubjects(stdout).filter((subject) => subject.endsWith(`(#${ISSUE_NUMBER})`));
};

describe("lifecycle scripted end-to-end", () => {
  let originalCwd: string;
  let repo: string;
  let lifecycleDir: string;
  let worktreesRoot: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repo = mkdtempSync(join(tmpdir(), PREFIX));
    lifecycleDir = mkdtempSync(join(tmpdir(), LIFECYCLE_PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), WORKTREE_PREFIX));
    await initializeRepo(repo);
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repo, { recursive: true, force: true });
    rmSync(lifecycleDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("runs the lifecycle tools through local merge and cleanup", async () => {
    const runner = createRunner(repo);
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: repo, baseDir: lifecycleDir });
    const tools = createLifecycleTools(handle);

    const startOutput = await executeTool(tools.lifecycle_start_request, {
      summary: SUMMARY,
      goals: ["Create a branch", "Commit two batches", "Merge locally"],
      constraints: ["Do not touch contract"],
    });
    expect(startOutput).toContain("branch_ready");

    const started = await loadRecord(handle, ISSUE_NUMBER);
    await executeTool(tools.lifecycle_record_artifact, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.DESIGN,
      pointer: DESIGN_POINTER,
    });
    await executeTool(tools.lifecycle_record_artifact, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.PLAN,
      pointer: PLAN_POINTER,
    });

    await writeBatch(started.worktree, FIRST_SUMMARY);
    expect(
      await executeTool(tools.lifecycle_commit, {
        issue_number: ISSUE_NUMBER,
        scope: FIRST_SCOPE,
        summary: FIRST_SUMMARY,
        push: false,
      }),
    ).toContain("## Lifecycle commit recorded");

    await writeBatch(started.worktree, SECOND_SUMMARY);
    expect(
      await executeTool(tools.lifecycle_commit, {
        issue_number: ISSUE_NUMBER,
        scope: SECOND_SCOPE,
        summary: SECOND_SUMMARY,
        push: false,
      }),
    ).toContain("## Lifecycle commit recorded");

    const finishOutput = await executeTool(tools.lifecycle_finish, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "local-merge",
      wait_for_checks: false,
    });
    expect(finishOutput).toContain("## Lifecycle finished");
    expect(finishOutput).toMatch(new RegExp(`\\| ${ISSUE_NUMBER} \\| - \\| \\d{4}-\\d{2}-\\d{2}T`));

    const location = join(lifecycleDir, `${ISSUE_NUMBER}.json`);
    expect(existsSync(location)).toBe(true);
    const record = await readRecord(location);
    expect(record.issueNumber).toBe(ISSUE_NUMBER);
    expect(record.state).toBe(LIFECYCLE_STATES.CLEANED);
    expect(record.artifacts[ARTIFACT_KINDS.DESIGN]).toEqual([DESIGN_POINTER]);
    expect(record.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
    expect(record.artifacts[ARTIFACT_KINDS.WORKTREE]).toEqual([started.worktree]);
    expect(record.artifacts[ARTIFACT_KINDS.COMMIT]).toHaveLength(COMMIT_COUNT);
    expect(existsSync(started.worktree)).toBe(false);

    const history = await runGit(["log", HISTORY_FORMAT], repo);
    expect(history.exitCode).toBe(OK_EXIT_CODE);
    expect(getLifecycleSubjects(history.stdout)).toEqual([SECOND_MESSAGE, FIRST_MESSAGE]);
    expect(runner.calls.filter((call) => call.bin === "gh").length).toBeGreaterThan(NO_CALLS);
    expect(runner.calls.every((call) => call.bin !== "gh" || call.cwd === repo)).toBe(true);
    expect(runner.calls.some((call) => call.bin === "git" && isPush(call.args))).toBe(true);
    expect(runner.edits.at(-1)).toContain("state: cleaned");
  });

  it("renders all four artifact pointers into the issue body across the full chain", async () => {
    const runner = createRunner(repo);
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: repo, baseDir: lifecycleDir });
    const tools = createLifecycleTools(handle);

    await executeTool(tools.lifecycle_start_request, {
      summary: SUMMARY,
      goals: ["Track issue work"],
      constraints: ["Do not touch contract"],
    });
    const started = await loadRecord(handle, ISSUE_NUMBER);
    expect(started.state).toBe(LIFECYCLE_STATES.BRANCH_READY);

    await executeTool(tools.lifecycle_record_artifact, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.DESIGN,
      pointer: DESIGN_POINTER,
    });
    await executeTool(tools.lifecycle_record_artifact, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.PLAN,
      pointer: PLAN_POINTER,
    });

    await writeBatch(started.worktree, FIRST_SUMMARY);
    await executeTool(tools.lifecycle_commit, {
      issue_number: ISSUE_NUMBER,
      scope: FIRST_SCOPE,
      summary: FIRST_SUMMARY,
      push: false,
    });

    await executeTool(tools.lifecycle_finish, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "local-merge",
      wait_for_checks: false,
    });

    const finalBody = runner.edits.at(-1) ?? "";
    expect(finalBody).toContain(DESIGN_POINTER);
    expect(finalBody).toContain(PLAN_POINTER);
    expect(finalBody).toContain(started.worktree);
    expect(finalBody).toMatch(/\b[0-9a-f]{7,}\b/);
    expect(finalBody).toContain("state: cleaned");

    const reloaded = await loadRecord(handle, ISSUE_NUMBER);
    expect(reloaded.state).toBe(LIFECYCLE_STATES.CLEANED);
    expect(reloaded.artifacts[ARTIFACT_KINDS.DESIGN]).toEqual([DESIGN_POINTER]);
    expect(reloaded.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
    expect(reloaded.artifacts[ARTIFACT_KINDS.WORKTREE]).toEqual([started.worktree]);
    expect(reloaded.artifacts[ARTIFACT_KINDS.COMMIT].length).toBeGreaterThan(0);
  });
});
