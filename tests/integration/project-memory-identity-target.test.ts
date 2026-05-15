import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import { createProjectMemoryLookupTool, createProjectMemoryPromoteTool } from "@/tools/project-memory";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const PREFIX = "project-memory-identity-target-";
const TEST_TIMEOUT_MS = 20_000;
const ORIGIN = "https://github.com/Wuxie233/micode.git";
const UNRELATED_ORIGIN = "https://github.com/Wuxie233/unrelated-memory.git";
const ACTUAL_REPO = "actual-repo";
const UNRELATED_REPO = "unrelated-repo";
const NON_GIT_DIR = "non-git";
const ENTITY_NAME = "identity-target";
const POINTER = "thoughts/lifecycle/identity-target.md";
const DECISION = "Identity target sentinel resolves explicit project origin across non git directories";
const MARKDOWN = `## Decisions\n- ${DECISION}\n`;
const QUERY = "identity target sentinel";
const LIMIT = 5;
const TOOL_CONTEXT = {} as unknown as ToolContext;

type ExecuteSignature = (raw: unknown, context: ToolContext) => Promise<ToolResult>;

let root: string;
let memory: ProjectMemoryStore;

function createContext(directory: string): PluginInput {
  return { directory } as PluginInput;
}

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function executeTool(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as ExecuteSignature;
  return stringify(await execute(args, TOOL_CONTEXT));
}

async function createRepo(name: string, origin: string): Promise<string> {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  await $`git init -q`.cwd(directory);
  await $`git remote add origin ${origin}`.cwd(directory);
  return directory;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), PREFIX));
  memory = createProjectMemoryStore({ dbDir: join(root, "memory") });
  setProjectMemoryStoreForTest(memory);
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  rmSync(root, { recursive: true, force: true });
});

describe("project memory explicit identity target", () => {
  it(
    "promotes from a non-git directory to an explicit origin and looks it up from the matching repo only",
    async () => {
      const actualRepo = await createRepo(ACTUAL_REPO, ORIGIN);
      const unrelatedRepo = await createRepo(UNRELATED_REPO, UNRELATED_ORIGIN);
      const nonGit = join(root, NON_GIT_DIR);
      mkdirSync(nonGit, { recursive: true });

      const actualIdentity = await resolveProjectId(actualRepo);
      const unrelatedIdentity = await resolveProjectId(unrelatedRepo);
      const promote = createProjectMemoryPromoteTool(createContext(nonGit)).project_memory_promote;
      const lookupActual = createProjectMemoryLookupTool(createContext(actualRepo)).project_memory_lookup;
      const lookupUnrelated = createProjectMemoryLookupTool(createContext(unrelatedRepo)).project_memory_lookup;

      const promoted = await executeTool(promote, {
        markdown: MARKDOWN,
        entity_name: ENTITY_NAME,
        source_kind: "lifecycle",
        pointer: POINTER,
        project_origin: ORIGIN,
      });
      const actualHits = await executeTool(lookupActual, { query: QUERY, limit: LIMIT });
      const unrelatedHits = await executeTool(lookupUnrelated, { query: QUERY, limit: LIMIT });

      expect(actualIdentity.kind).toBe("origin");
      expect(actualIdentity.source).toBe("github.com/wuxie233/micode");
      expect(unrelatedIdentity.projectId).not.toBe(actualIdentity.projectId);
      expect(promoted).toContain("## Project memory promoted");
      expect(promoted).toContain(DECISION);
      expect(actualHits).toContain(DECISION);
      expect(actualHits).toContain(POINTER);
      expect(unrelatedHits).toContain("No project memory entries");
      expect(unrelatedHits).not.toContain(DECISION);
      expect(await memory.countEntries(actualIdentity.projectId)).toBe(1);
      expect(await memory.countEntries(unrelatedIdentity.projectId)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
