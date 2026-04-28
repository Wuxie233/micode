import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import { createProjectMemoryLookupTool } from "@/tools/project-memory/lookup";
import { createProjectMemoryPromoteTool } from "@/tools/project-memory/promote";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const ROOT_PREFIX = "project-memory-worktree-";
const ORIGIN_URL = "https://github.com/Wuxie233/micode.git";
const MAIN_BRANCH = "main";
const WORKTREE_A_BRANCH = "memory-a";
const WORKTREE_B_BRANCH = "memory-b";
const README_FILE = "README.md";
const REPO_NAME = "micode";
const INITIAL_COMMIT = "chore: initial";
const TOOL_CONTEXT = {} as unknown as ToolContext;
const LINE_BREAK = "\n";
const OK_EXIT_CODE = 0;
const ENTITY_NAME = "memory";
const POINTER = "thoughts/lifecycle/worktree-durability.md";
const DECISION = "Worktree durability survives worktree deletion through shared origin identity";
const QUERY = "worktree durability";
const LOOKUP_LIMIT = 5;
const EXPECTED_ENTRY_COUNT = 1;

interface FixturePaths {
  readonly repo: string;
  readonly store: string;
  readonly worktrees: string;
  readonly left: string;
  readonly right: string;
}

type ExecuteSignature = (raw: unknown, context: ToolContext) => Promise<ToolResult>;

function createContext(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function executeTool(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await execute(args, TOOL_CONTEXT));
}

async function requireGit(args: readonly string[], cwd: string): Promise<void> {
  const tokens = [...args];
  const completed = await $`git ${tokens}`.cwd(cwd).quiet().nothrow();
  if (completed.exitCode === OK_EXIT_CODE) return;
  throw new Error(`git ${args.join(" ")} failed: ${completed.stderr}${completed.stdout}`);
}

function pathsFor(root: string): FixturePaths {
  const worktrees = join(root, "worktrees");
  return {
    repo: join(root, "repo"),
    store: join(root, "memory"),
    worktrees,
    left: join(worktrees, "left"),
    right: join(worktrees, "right"),
  };
}

async function initializeRepo(repo: string): Promise<void> {
  mkdirSync(repo);
  await requireGit(["init", "--initial-branch", MAIN_BRANCH, "-q"], repo);
  await requireGit(["config", "user.name", "Micode Test"], repo);
  await requireGit(["config", "user.email", "micode@example.invalid"], repo);
  await Bun.write(join(repo, README_FILE), `# ${REPO_NAME}${LINE_BREAK}`);
  await requireGit(["add", README_FILE], repo);
  await requireGit(["commit", "-q", "-m", INITIAL_COMMIT], repo);
  await requireGit(["remote", "add", "origin", ORIGIN_URL], repo);
}

async function createWorktrees(paths: FixturePaths): Promise<void> {
  mkdirSync(paths.worktrees);
  await requireGit(["worktree", "add", "-q", "-b", WORKTREE_A_BRANCH, paths.left], paths.repo);
  await requireGit(["worktree", "add", "-q", "-b", WORKTREE_B_BRANCH, paths.right], paths.repo);
}

async function createFixture(root: string): Promise<FixturePaths> {
  const paths = pathsFor(root);
  await initializeRepo(paths.repo);
  await createWorktrees(paths);
  return paths;
}

async function promoteFrom(directory: string): Promise<string> {
  const toolDef = createProjectMemoryPromoteTool(createContext(directory)).project_memory_promote;
  return executeTool(toolDef, {
    markdown: `## Decisions${LINE_BREAK}- ${DECISION}${LINE_BREAK}`,
    entity_name: ENTITY_NAME,
    source_kind: "lifecycle",
    pointer: POINTER,
  });
}

async function lookupFrom(directory: string): Promise<string> {
  const toolDef = createProjectMemoryLookupTool(createContext(directory)).project_memory_lookup;
  return executeTool(toolDef, { query: QUERY, limit: LOOKUP_LIMIT });
}

describe("project memory worktree durability", () => {
  let root: string;
  let store: ProjectMemoryStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), ROOT_PREFIX));
    store = createProjectMemoryStore({ dbDir: pathsFor(root).store });
    setProjectMemoryStoreForTest(store);
  });

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps promoted memory durable after the promoting worktree is deleted", async () => {
    const paths = await createFixture(root);
    const leftIdentity = await resolveProjectId(paths.left);
    const rightIdentity = await resolveProjectId(paths.right);

    expect(paths.store.startsWith(paths.left)).toBe(false);
    expect(paths.store.startsWith(paths.right)).toBe(false);
    expect(leftIdentity.kind).toBe("origin");
    expect(rightIdentity.kind).toBe("origin");
    expect(rightIdentity.projectId).toBe(leftIdentity.projectId);
    expect(rightIdentity.source).toBe(leftIdentity.source);

    const promoted = await promoteFrom(paths.left);
    expect(promoted).toContain("## Project memory promoted");
    expect(promoted).toContain(DECISION);
    expect(await store.countEntries(rightIdentity.projectId)).toBe(EXPECTED_ENTRY_COUNT);

    const beforeDelete = await lookupFrom(paths.right);
    expect(beforeDelete).toContain(DECISION);
    expect(beforeDelete).toContain(POINTER);

    await requireGit(["worktree", "remove", "--force", paths.left], paths.repo);
    expect(existsSync(paths.left)).toBe(false);

    const afterDelete = await lookupFrom(paths.right);
    expect(afterDelete).toContain(DECISION);
    expect(afterDelete).toContain(POINTER);
  });
});
