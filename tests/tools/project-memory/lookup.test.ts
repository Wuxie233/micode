import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createProjectRegistry } from "@/project-memory/registry";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import { type Entity, type Entry, type Source, type Status, StatusValues } from "@/project-memory/types";
import { createProjectMemoryLookupTool } from "@/tools/project-memory/lookup";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { projectIdForSource, resolveProjectId } from "@/utils/project-id";

const QUERY = "permission";
const ACTIVE_TITLE = "Cache permission TTL";
const TENTATIVE_TITLE = "Tentative permission cache";
const ARCHIVED_TITLE = "Archived permission cache";
const TOMBSTONED_TITLE = "Tombstoned permission cache";
const DEPRECATED_TITLE = "Deprecated permission cache";
const SUPERSEDED_TITLE = "Superseded permission cache";
const TARGET_TITLE = "Target origin permission cache";
const ALIAS_TARGET_TITLE = "Alias origin permission cache";
const ENTITY_ID = "entity-auth";
const ACTIVE_ENTRY_ID = "entry-active";
const TENTATIVE_ENTRY_ID = "entry-tentative";
const ORIGIN_URL = "https://github.com/Wuxie233/other-project.git";
const ORIGIN_SOURCE = "github.com/wuxie233/other-project";
const PROJECT_ALIAS = "other-project";
const SOURCE_ID = "source-active";
const POINTER = "manual://permission-cache";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const LIMIT = 5;
const FAILURE_MESSAGE = "lookup exploded";
const TOOL_CONTEXT = {} as ToolContext;
const PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS = 20_000;

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

async function seedStatusEntry(
  store: ProjectMemoryStore,
  projectId: string,
  status: Status,
  title: string,
  id = `entry-${status}`,
): Promise<void> {
  await store.upsertEntry(entry(projectId, { id, title, status }));
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
  let originalRegistryFile: string;

  beforeEach(() => {
    originalRegistryFile = config.projectMemory.registryFile;
  });

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    (config.projectMemory as { registryFile: string }).registryFile = originalRegistryFile;
    rmSync(directory, { recursive: true, force: true });
  });

  it(
    "returns lookup markdown from the project-scoped memory store",
    async () => {
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
    },
    PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS,
  );

  it(
    "excludes historical statuses by default and returns archived entries when explicitly requested",
    async () => {
      directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-history-"));
      const identity = await resolveProjectId(directory);
      const store = createProjectMemoryStore({ dbDir: join(directory, "memory") });
      await seedMemory(store, identity.projectId);
      await seedStatusEntry(store, identity.projectId, "archived", ARCHIVED_TITLE);
      await seedStatusEntry(store, identity.projectId, "tombstoned", TOMBSTONED_TITLE);
      await seedStatusEntry(store, identity.projectId, "deprecated", DEPRECATED_TITLE);
      await seedStatusEntry(store, identity.projectId, "superseded", SUPERSEDED_TITLE);
      setProjectMemoryStoreForTest(store);

      const tools = createProjectMemoryLookupTool(createContext(directory));
      const defaultOutput = await executeTool(tools.project_memory_lookup, { query: QUERY, limit: LIMIT });
      const archivedOutput = await executeTool(tools.project_memory_lookup, {
        query: QUERY,
        status: "archived",
        limit: LIMIT,
      });

      expect(defaultOutput).toContain(ACTIVE_TITLE);
      expect(defaultOutput).not.toContain(ARCHIVED_TITLE);
      expect(defaultOutput).not.toContain(TOMBSTONED_TITLE);
      expect(defaultOutput).not.toContain(DEPRECATED_TITLE);
      expect(defaultOutput).not.toContain(SUPERSEDED_TITLE);
      expect(archivedOutput).toContain(ARCHIVED_TITLE);
      expect(archivedOutput).not.toContain(ACTIVE_TITLE);
    },
    PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS,
  );

  it(
    "looks up an explicit project origin from a non-project directory",
    async () => {
      directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-target-"));
      const fallbackIdentity = await resolveProjectId(directory);
      const targetProjectId = projectIdForSource(ORIGIN_SOURCE);
      const store = createProjectMemoryStore({ dbDir: join(directory, "memory") });
      await store.initialize();
      await store.upsertEntity(entity(targetProjectId));
      await store.upsertEntry(entry(targetProjectId, { title: TARGET_TITLE }));
      await store.upsertEntity(entity(fallbackIdentity.projectId, { name: "fallback" }));
      await store.upsertEntry(entry(fallbackIdentity.projectId, { title: ACTIVE_TITLE }));
      setProjectMemoryStoreForTest(store);

      const tools = createProjectMemoryLookupTool(createContext(directory));
      const output = await executeTool(tools.project_memory_lookup, {
        query: QUERY,
        project_origin: ORIGIN_URL,
        limit: LIMIT,
      });

      expect(output).toContain(TARGET_TITLE);
      expect(output).not.toContain(ACTIVE_TITLE);
    },
    PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS,
  );

  it(
    "resolves registry aliases and worktrees to the origin-backed project",
    async () => {
      directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-registry-"));
      const worktree = join(directory, "worktree");
      const targetProjectId = projectIdForSource(ORIGIN_SOURCE);
      const fallbackIdentity = await resolveProjectId(directory);
      const store = createProjectMemoryStore({ dbDir: join(directory, "memory") });
      await store.initialize();
      await store.upsertEntity(entity(targetProjectId));
      await store.upsertEntry(entry(targetProjectId, { title: ALIAS_TARGET_TITLE }));
      await store.upsertEntity(entity(fallbackIdentity.projectId, { name: "fallback" }));
      await store.upsertEntry(entry(fallbackIdentity.projectId, { title: ACTIVE_TITLE }));
      setProjectMemoryStoreForTest(store);
      (config.projectMemory as { registryFile: string }).registryFile = join(directory, "registry.json");
      const registry = createProjectRegistry({ filePath: config.projectMemory.registryFile });
      await registry.upsert({
        projectId: targetProjectId,
        origin: ORIGIN_URL,
        aliases: [PROJECT_ALIAS],
        worktrees: [worktree],
        updatedAt: UPDATED_AT,
      });

      const tools = createProjectMemoryLookupTool(createContext(directory));
      const aliasOutput = await executeTool(tools.project_memory_lookup, {
        query: QUERY,
        project_alias: PROJECT_ALIAS,
        limit: LIMIT,
      });
      const worktreeOutput = await executeTool(tools.project_memory_lookup, {
        query: QUERY,
        project_worktree: worktree,
        limit: LIMIT,
      });

      expect(aliasOutput).toContain(ALIAS_TARGET_TITLE);
      expect(aliasOutput).not.toContain(ACTIVE_TITLE);
      expect(worktreeOutput).toContain(ALIAS_TARGET_TITLE);
      expect(worktreeOutput).not.toContain(ACTIVE_TITLE);
    },
    PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS,
  );

  it(
    "returns a friendly error instead of throwing",
    async () => {
      directory = mkdtempSync(join(tmpdir(), "pm-lookup-tool-error-"));
      setProjectMemoryStoreForTest(createFailingStore());

      const tools = createProjectMemoryLookupTool(createContext(directory));
      const output = await executeTool(tools.project_memory_lookup, { query: QUERY });

      expect(output).toBe(`## Error\n\n${FAILURE_MESSAGE}`);
    },
    PROJECT_MEMORY_TOOL_TEST_TIMEOUT_MS,
  );
});
