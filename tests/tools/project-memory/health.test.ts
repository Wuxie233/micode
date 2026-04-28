import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import {
  createProjectMemoryStore,
  type Entity,
  type Entry,
  type ProjectMemoryStore,
  type Source,
  type Status,
} from "@/project-memory";
import { createProjectMemoryHealthTool } from "@/tools/project-memory/health";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const ENTITY_ID = "entity-auth";
const OTHER_ENTITY_ID = "entity-billing";
const ACTIVE_ENTRY_ID = "entry-active";
const TENTATIVE_ENTRY_ID = "entry-tentative";
const DEPRECATED_ENTRY_ID = "entry-deprecated";
const SOURCE_ID = "source-health";
const CREATED_AT = 1;
const MS_PER_DAY = 86_400_000;
const STALE_AGE_DAYS = 91;
const RECENT_AGE_DAYS = 1;
const EXPECTED_TWO = 2;
const EXPECTED_THREE = 3;
const STORE_ERROR = "store unavailable";
const TOOL_CONTEXT = {} as unknown as ToolContext;

let workdir: string;
let dbDir: string;
let stores: ProjectMemoryStore[];

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "pmhealth-work-"));
  dbDir = mkdtempSync(join(tmpdir(), "pmhealth-db-"));
  stores = [];
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  await Promise.all(stores.map((store) => store.close()));
  rmSync(workdir, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

function createStore(): ProjectMemoryStore {
  const store = createProjectMemoryStore({ dbDir });
  stores.push(store);
  return store;
}

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function runHealthTool(): Promise<string> {
  const toolDef = createProjectMemoryHealthTool({ directory: workdir } as unknown as PluginInput).project_memory_health;
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec({}, TOOL_CONTEXT));
}

function entity(projectId: string, overrides: Partial<Entity> = {}): Entity {
  return {
    projectId,
    id: ENTITY_ID,
    kind: "module",
    name: "auth",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function entry(projectId: string, overrides: Partial<Entry> = {}): Entry {
  return {
    projectId,
    id: ACTIVE_ENTRY_ID,
    entityId: ENTITY_ID,
    type: "decision",
    title: "Use SQLite",
    summary: "Store project memory in SQLite",
    status: "active",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function source(projectId: string, overrides: Partial<Source> = {}): Source {
  return {
    projectId,
    id: SOURCE_ID,
    entryId: ACTIVE_ENTRY_ID,
    kind: "manual",
    pointer: "manual://health",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function emptyStatusCounts(): Record<Status, number> {
  return {
    active: 0,
    superseded: 0,
    tentative: 0,
    hypothesis: 0,
    deprecated: 0,
  };
}

function staleTimestamp(now: number): number {
  return now - STALE_AGE_DAYS * MS_PER_DAY;
}

function recentTimestamp(now: number): number {
  return now - RECENT_AGE_DAYS * MS_PER_DAY;
}

function createFailingStore(): ProjectMemoryStore {
  const noop = async (): Promise<void> => undefined;
  return {
    initialize: noop,
    upsertEntity: noop,
    upsertEntry: noop,
    upsertRelation: noop,
    upsertSource: noop,
    loadEntity: async () => null,
    loadEntry: async () => null,
    loadSourcesForEntry: async () => [],
    searchEntries: async () => [],
    countEntities: async () => {
      throw new Error(STORE_ERROR);
    },
    countEntries: async () => 0,
    countEntriesByStatus: async () => emptyStatusCounts(),
    countSources: async () => 0,
    countMissingSources: async () => 0,
    countStaleEntries: async () => 0,
    forgetEntry: noop,
    forgetEntity: noop,
    forgetSource: noop,
    forgetProject: noop,
    close: noop,
  };
}

describe("project_memory_health tool", () => {
  it("returns a markdown report with counts, status breakdown, and identity warnings", async () => {
    const store = createStore();
    const now = Date.now();
    const identity = await resolveProjectId(workdir);
    await store.initialize();
    setProjectMemoryStoreForTest(store);

    await store.upsertEntity(entity(identity.projectId));
    await store.upsertEntity(entity(identity.projectId, { id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry(identity.projectId, { updatedAt: recentTimestamp(now) }));
    await store.upsertEntry(
      entry(identity.projectId, { id: TENTATIVE_ENTRY_ID, status: "tentative", updatedAt: staleTimestamp(now) }),
    );
    await store.upsertEntry(
      entry(identity.projectId, { id: DEPRECATED_ENTRY_ID, entityId: OTHER_ENTITY_ID, status: "deprecated" }),
    );
    await store.upsertSource(source(identity.projectId));

    const output = await runHealthTool();

    expect(output).toContain("## Project Memory Health");
    expect(output).toContain(`- **Project ID:** \`${identity.projectId}\``);
    expect(output).toContain("- **Identity:** `path`");
    expect(output).toContain(`- **Entities:** ${EXPECTED_TWO}`);
    expect(output).toContain(`- **Entries:** ${EXPECTED_THREE}`);
    expect(output).toContain("- **active:** 1");
    expect(output).toContain("- **tentative:** 1");
    expect(output).toContain("- **deprecated:** 1");
    expect(output).toContain("- **Stale entries:** 1");
    expect(output).toContain(`- **Missing sources:** ${EXPECTED_TWO}`);
    expect(output).toContain(`- **Recent updates:** ${EXPECTED_TWO}`);
    expect(output).toContain("- identity_degraded: origin not resolved");
  });

  it("returns a friendly error report instead of throwing", async () => {
    setProjectMemoryStoreForTest(createFailingStore());

    await expect(runHealthTool()).resolves.toBe(`## Error\n\n${STORE_ERROR}`);
  });
});
