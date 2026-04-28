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

const PREFIX = "project-memory-isolation-";
const REPO_A = "repo-a";
const REPO_B = "repo-b";
const ORIGIN_A = "https://github.com/Wuxie233/micode-alpha.git";
const ORIGIN_B = "https://github.com/Wuxie233/micode-beta.git";
const ENTITY_NAME = "permission-cache";
const POINTER = "thoughts/lifecycle/isolation.md";
const DECISION = "Permission cache isolation sentinel uses repo alpha";
const MARKDOWN = `## Decisions\n- ${DECISION}\n`;
const QUERY = "permission cache isolation sentinel";
const EXPECTED_ONE = 1;
const EXPECTED_ZERO = 0;
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

describe("project memory project isolation", () => {
  it("does not leak promoted lifecycle decisions across repos sharing one store", async () => {
    const repoA = await createRepo(REPO_A, ORIGIN_A);
    const repoB = await createRepo(REPO_B, ORIGIN_B);
    const identityA = await resolveProjectId(repoA);
    const identityB = await resolveProjectId(repoB);
    const promote = createProjectMemoryPromoteTool(createContext(repoA)).project_memory_promote;
    const lookupA = createProjectMemoryLookupTool(createContext(repoA)).project_memory_lookup;
    const lookupB = createProjectMemoryLookupTool(createContext(repoB)).project_memory_lookup;

    const promoted = await executeTool(promote, {
      markdown: MARKDOWN,
      entity_name: ENTITY_NAME,
      source_kind: "lifecycle",
      pointer: POINTER,
    });
    const hitsB = await executeTool(lookupB, { query: QUERY, limit: LIMIT });
    const hitsA = await executeTool(lookupA, { query: QUERY, limit: LIMIT });

    expect(identityA.projectId).not.toBe(identityB.projectId);
    expect(promoted).toContain("## Project memory promoted");
    expect(promoted).toContain(DECISION);
    expect(hitsB).toContain("No project memory entries");
    expect(hitsB).not.toContain(DECISION);
    expect(hitsA).toContain(DECISION);
    expect(await memory.countEntries(identityA.projectId)).toBe(EXPECTED_ONE);
    expect(await memory.countEntries(identityB.projectId)).toBe(EXPECTED_ZERO);
  });
});
