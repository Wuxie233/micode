import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import { type Entity, type Entry, type Source, type Status, StatusValues } from "@/project-memory/types";
import { createProjectMemoryLookupTool } from "@/tools/project-memory/lookup";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const QUERY = "permission";
const ACTIVE_TITLE = "Cache permission TTL";
const TENTATIVE_TITLE = "Tentative permission cache";
const ENTITY_ID = "entity-auth";
const ACTIVE_ENTRY_ID = "entry-active";
const TENTATIVE_ENTRY_ID = "entry-tentative";
const SOURCE_ID = "source-active";
const POINTER = "manual://permission-cache";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const LIMIT = 5;
const FAILURE_MESSAGE = "lookup exploded";
const TOOL_CONTEXT = {} as ToolContext;

type ExecuteSignature = (raw: unknown, context: ToolContext) => Promise<ToolResult>;

const statusCounts = (): Record<Status, number> =>
  Object.fromEntries(StatusValues.map((status) => [status, 0])) as Record<Status, number>;

function createContext(directory: string): PluginInput {
  return { directory } as PluginInput;
}

function stringify(result: ToolResult): string {
  if (typeof result === "string") return result;
  return result.output;
}

async function executeTool(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as ExecuteSignature;
  return stringify(await execute(args, TOOL_CONTEXT));
}

function entity(projectId: string): Entity {
  return {
    projectId,
    id: ENTITY_ID,
    kind: "module",
    name: "auth",
    summary: "Authentication module",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function entry(projectId: string, overrides: Partial<Entry> = {}): Entry {
  return {
    projectId,
    id: ACTIVE_ENTRY_ID,
    entityId: ENTITY_ID,
    type: "decision",
    title: ACTIVE_TITLE,
    summary: "permission cache uses a short TTL",
    status: "active",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function source(projectId: string): Source {
  return {
    projectId,
    id: SOURCE_ID,
    entryId: ACTIVE_ENTRY_ID,
    kind: "manual",
    pointer: POINTER,
    createdAt: CREATED_AT,
  };
}

async function seedMemory(store: ProjectMemoryStore, projectId: string): Promise<void> {
  await store.initialize();
  await store.upsertEntity(entity(projectId));
  await store.upsertEntry(entry(projectId));
  await store.upsertEntry(
    entry(projectId, {
      id: TENTATIVE_ENTRY_ID,
      title: TENTATIVE_TITLE,
      status: "tentative",
    }),
  );
  await store.upsertSource(source(projectId));
}

function createFailingStore(): ProjectMemoryStore {
  return {
    initialize: async () => {},
    upsertEntity: async () => {},
    upsertEntry: async () => {},
    upsertRelation: async () => {},
    upsertSource: async () => {},
    loadEntity: async () => null,
    loadEntry: async () => null,
    loadSourcesForEntry: async () => [],
    searchEntries: async () => {
      throw new Error(FAILURE_MESSAGE);
    },
    countEntities: async () => 0,
    countEntries: async () => 0,
    countEntriesByStatus: async () => statusCounts(),
    countSources: async () => 0,
    countMissingSources: async () => 0,
    countStaleEntries: async () => 0,
    forgetEntry: async () => {},
    forgetEntity: async () => {},
    forgetSource: async () => {},
    forgetProject: async () => {},
    close: async () => {},
  };
}

describe("project_memory_lookup", () => {
  let directory: string;

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns lookup markdown from the project-scoped memory store", async () => {
    directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-"));
    const identity = await resolveProjectId(directory);
    const store = createProjectMemoryStore({ dbDir: join(directory, "memory") });
    await seedMemory(store, identity.projectId);
    setProjectMemoryStoreForTest(store);

    const tools = createProjectMemoryLookupTool(createContext(directory));
    const output = await executeTool(tools.project_memory_lookup, {
      query: QUERY,
      type: "decision",
      limit: LIMIT,
    });

    expect(output).toContain("## Project Memory");
    expect(output).toContain(ACTIVE_TITLE);
    expect(output).toContain(POINTER);
    expect(output).toContain("Query: `permission`");
    expect(output).not.toContain(TENTATIVE_TITLE);
  });

  it("returns a friendly error instead of throwing", async () => {
    directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-error-"));
    setProjectMemoryStoreForTest(createFailingStore());

    const tools = createProjectMemoryLookupTool(createContext(directory));
    const output = await executeTool(tools.project_memory_lookup, { query: QUERY });

    expect(output).toBe(`## Error\n\n${FAILURE_MESSAGE}`);
  });
});
