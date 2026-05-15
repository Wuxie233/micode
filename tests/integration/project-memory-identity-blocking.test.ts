import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import {
  createProjectMemoryStore,
  type Entity,
  type Entry,
  type ProjectMemoryStore,
  type Source,
} from "@/project-memory";
import { type MaintenanceJournalEvent, readMaintenanceJournal } from "@/project-memory/maintenance/journal";
import { createProjectRegistry } from "@/project-memory/registry";
import {
  createProjectMemoryHealthTool,
  createProjectMemoryLookupTool,
  createProjectMemoryMaintainTool,
  createProjectMemoryPromoteTool,
} from "@/tools/project-memory";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { projectIdForSource, resolveProjectId } from "@/utils/project-id";

const TOOL_CONTEXT = {} as unknown as ToolContext;
const ROOT_PREFIX = "project-memory-identity-blocking-";
const PROJECT_ALIAS = "micode";
const ORIGIN_A = "https://github.com/Wuxie233/micode.git";
const ORIGIN_B = "https://github.com/Wuxie233/micode-shadow.git";
const SOURCE_A = "github.com/wuxie233/micode";
const SOURCE_B = "github.com/wuxie233/micode-shadow";
const PROJECT_A = projectIdForSource(SOURCE_A);
const PROJECT_B = projectIdForSource(SOURCE_B);
const ALIAS_PROJECT = projectIdForSource(PROJECT_ALIAS);
const ENTITY_NAME = "project-memory";
const ENTRY_ID_A = "entry-archive-a";
const ENTRY_ID_B = "entry-archive-b";
const CREATED_AT = 1;
const OLD = 1;
const PROMOTED_DECISION = "Ambiguous alias promotion must not pick a project";
const PROMOTION_MARKDOWN = `## Decisions\n- ${PROMOTED_DECISION}\n`;
const POINTER = "thoughts/lifecycle/identity-blocking.md";
const LOOKUP_QUERY = "identity blocking sentinel";
const EXPECTED_ZERO = 0;
const EXPECTED_ONE = 1;

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

let root: string;
let store: ProjectMemoryStore;
let originalRegistryFile: string;
let originalJournalDir: string;

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function executeTool(toolDef: ToolDefinition, args: Record<string, unknown> = {}): Promise<string> {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
}

function createCtx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

function createPlainDirectory(name: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

async function seedAmbiguousAliasRegistry(): Promise<void> {
  const registry = createProjectRegistry({ filePath: config.projectMemory.registryFile });
  await registry.upsert({
    projectId: "registry-project-a",
    origin: ORIGIN_A,
    aliases: [PROJECT_ALIAS],
    worktrees: [],
    updatedAt: 1,
  });
  await registry.upsert({
    projectId: "registry-project-b",
    origin: ORIGIN_B,
    aliases: [PROJECT_ALIAS],
    worktrees: [],
    updatedAt: 2,
  });
}

function entity(projectId: string, id: string): Entity {
  return {
    projectId,
    id,
    kind: "module",
    name: "project-memory",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function entry(projectId: string, entityId: string, id: string): Entry {
  return {
    projectId,
    id,
    entityId,
    type: "note",
    title: "Archive me",
    summary: "Old low-signal note used to prove blocked maintenance does not mutate entries.",
    status: "deprecated",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: OLD,
  };
}

function source(projectId: string, entryId: string): Source {
  return {
    projectId,
    id: `source-${entryId}`,
    entryId,
    kind: "manual",
    pointer: `manual://${entryId}`,
    createdAt: CREATED_AT,
  };
}

async function seedMaintenanceCandidate(projectId: string, entryId: string): Promise<void> {
  const entityId = `entity-${entryId}`;
  await store.upsertEntity(entity(projectId, entityId));
  await store.upsertEntry(entry(projectId, entityId, entryId));
  await store.upsertSource(source(projectId, entryId));
}

function isBlockedJournalEvent(event: MaintenanceJournalEvent): boolean {
  return event.action === "needs_review" && event.counts?.blocked === EXPECTED_ONE;
}

async function expectOnlyOptionalBlockedJournal(projectId: string): Promise<void> {
  const journal = await readMaintenanceJournal(projectId);
  expect(journal.every(isBlockedJournalEvent)).toBe(true);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), ROOT_PREFIX));
  originalRegistryFile = config.projectMemory.registryFile;
  originalJournalDir = config.projectMemory.maintenanceJournalDir;
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).registryFile = join(
    root,
    "registry.json",
  );
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).maintenanceJournalDir = join(
    root,
    "journal",
  );
  store = createProjectMemoryStore({ dbDir: join(root, "db") });
  await store.initialize();
  setProjectMemoryStoreForTest(store);
  await seedAmbiguousAliasRegistry();
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).registryFile = originalRegistryFile;
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).maintenanceJournalDir =
    originalJournalDir;
  rmSync(root, { recursive: true, force: true });
});

describe("project memory identity blocking", () => {
  it("refuses non-project promotion through an ambiguous alias without writing entries", async () => {
    const directory = createPlainDirectory("non-project-promote");
    const toolDef = createProjectMemoryPromoteTool(createCtx(directory)).project_memory_promote;

    const output = await executeTool(toolDef, {
      markdown: PROMOTION_MARKDOWN,
      entity_name: ENTITY_NAME,
      source_kind: "lifecycle",
      pointer: POINTER,
      project_alias: PROJECT_ALIAS,
    });

    expect(output).toContain("## Error");
    expect(output).toContain("## Project memory promotion refused");
    expect(output.toLowerCase()).toContain("ambiguous");
    expect(output).toContain(`project_alias=${PROJECT_ALIAS}`);
    expect(await store.countEntries(PROJECT_A)).toBe(EXPECTED_ZERO);
    expect(await store.countEntries(PROJECT_B)).toBe(EXPECTED_ZERO);
    expect(await store.countEntries(ALIAS_PROJECT)).toBe(EXPECTED_ZERO);
  });

  it("blocks ambiguous alias maintenance without mutating either matched project", async () => {
    const directory = createPlainDirectory("non-project-maintain");
    await seedMaintenanceCandidate(PROJECT_A, ENTRY_ID_A);
    await seedMaintenanceCandidate(PROJECT_B, ENTRY_ID_B);
    const toolDef = createProjectMemoryMaintainTool(createCtx(directory)).project_memory_maintain;

    const output = await executeTool(toolDef, { dry_run: false, project_alias: PROJECT_ALIAS });

    expect(output).toContain("## Error");
    expect(output.toLowerCase()).toContain("ambiguous");
    expect(output).toContain(`project_alias=${PROJECT_ALIAS}`);
    expect(await store.loadEntry(PROJECT_A, ENTRY_ID_A)).toMatchObject({ status: "deprecated" });
    expect(await store.loadEntry(PROJECT_B, ENTRY_ID_B)).toMatchObject({ status: "deprecated" });
    await expectOnlyOptionalBlockedJournal(PROJECT_A);
    await expectOnlyOptionalBlockedJournal(PROJECT_B);
  });

  it("refuses path-only promote and maintenance writes because degraded identities cannot write", async () => {
    const directory = createPlainDirectory("path-only-write");
    const identity = await resolveProjectId(directory);
    const promote = createProjectMemoryPromoteTool(createCtx(directory)).project_memory_promote;
    const maintain = createProjectMemoryMaintainTool(createCtx(directory)).project_memory_maintain;

    const promoted = await executeTool(promote, {
      markdown: PROMOTION_MARKDOWN,
      entity_name: ENTITY_NAME,
      source_kind: "lifecycle",
      pointer: POINTER,
    });
    const maintained = await executeTool(maintain, { dry_run: false });

    expect(identity.kind).toBe("path");
    expect(promoted).toContain("## Project memory promotion refused");
    expect(promoted.toLowerCase()).toContain("degraded identity");
    expect(maintained).toContain("## Error");
    expect(maintained.toLowerCase()).toContain("degraded identity");
    expect(await store.countEntries(identity.projectId)).toBe(EXPECTED_ZERO);
    expect(await store.countEntities(identity.projectId)).toBe(EXPECTED_ZERO);
  });

  it("allows degraded read-only health and lookup while leaving the path-only project empty", async () => {
    const directory = createPlainDirectory("path-only-read");
    const identity = await resolveProjectId(directory);
    const health = createProjectMemoryHealthTool(createCtx(directory)).project_memory_health;
    const lookup = createProjectMemoryLookupTool(createCtx(directory)).project_memory_lookup;

    const healthOutput = await executeTool(health);
    const lookupOutput = await executeTool(lookup, { query: LOOKUP_QUERY, limit: 5 });

    expect(identity.kind).toBe("path");
    expect(healthOutput).toContain("## Project Memory Health");
    expect(healthOutput).toContain("- **Identity:** `path`");
    expect(healthOutput).toContain("identity_degraded: origin not resolved");
    expect(lookupOutput).toContain("## Project Memory");
    expect(lookupOutput).toContain("No project memory entries");
    expect(await store.countEntries(identity.projectId)).toBe(EXPECTED_ZERO);
    expect(await store.countEntities(identity.projectId)).toBe(EXPECTED_ZERO);
    expect(await store.countSources(identity.projectId)).toBe(EXPECTED_ZERO);
  });
});
