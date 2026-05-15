import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import {
  createProjectMemoryStore,
  type Entity,
  type Entry,
  type ProjectMemoryStore,
  type Source,
} from "@/project-memory";
import { DEFAULT_MAINTENANCE_STALE_AFTER_MS } from "@/project-memory/maintenance/classifier";
import { readMaintenanceJournal } from "@/project-memory/maintenance/journal";
import { createProjectMemoryMaintainTool } from "@/tools/project-memory/maintain";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { type ProjectIdentity, resolveProjectId } from "@/utils/project-id";

const TOOL_CONTEXT = {} as unknown as ToolContext;
const REMOTE = "https://github.com/Wuxie233/micode.git";
const ENTITY_ID = "entity-one";
const ARCHIVE_ENTRY_ID = "entry-archive";
const DUPLICATE_OLD_ID = "entry-duplicate-old";
const DUPLICATE_NEW_ID = "entry-duplicate-new";
const REVIEW_ENTRY_ID = "entry-review";
const CREATED_AT = 1;
const NOW = 2_000_000_000;
const OLD = NOW - DEFAULT_MAINTENANCE_STALE_AFTER_MS - 1;
const RECENT = NOW - 1_000;
const EXPECTED_APPLIED = 3;

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

let root: string;
let workdir: string;
let store: ProjectMemoryStore;
let identity: ProjectIdentity;
let originalRegistryFile: string;
let originalJournalDir: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "pm-maintain-tool-"));
  workdir = join(root, "repo");
  mkdirSync(workdir);
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
  await $`git init -q`.cwd(workdir);
  await $`git remote add origin ${REMOTE}`.cwd(workdir);
  identity = await resolveProjectId(workdir);
  store = createProjectMemoryStore({ dbDir: join(root, "db") });
  await store.initialize();
  setProjectMemoryStoreForTest(store);
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).registryFile = originalRegistryFile;
  (config.projectMemory as { registryFile: string; maintenanceJournalDir: string }).maintenanceJournalDir =
    originalJournalDir;
  rmSync(root, { recursive: true, force: true });
});

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function executeMaintain(args: unknown, directory = workdir): Promise<string> {
  const tools = createProjectMemoryMaintainTool({ directory } as unknown as PluginInput);
  const exec = tools.project_memory_maintain.execute.bind(tools.project_memory_maintain) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: identity.projectId,
    id: ENTITY_ID,
    kind: "module",
    name: "auth",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    projectId: identity.projectId,
    id: ARCHIVE_ENTRY_ID,
    entityId: ENTITY_ID,
    type: "note",
    title: "Stable note",
    summary: "A useful project memory note.",
    status: "deprecated",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: OLD,
    ...overrides,
  };
}

function source(entryId: string, overrides: Partial<Source> = {}): Source {
  return {
    projectId: identity.projectId,
    id: `source-${entryId}`,
    entryId,
    kind: "manual",
    pointer: `manual://${entryId}`,
    createdAt: RECENT,
    ...overrides,
  };
}

async function seedMaintenanceCandidates(): Promise<void> {
  await store.upsertEntity(entity());
  await store.upsertEntry(entry({ id: ARCHIVE_ENTRY_ID, title: "Archive me", status: "deprecated", updatedAt: OLD }));
  await store.upsertEntry(
    entry({ id: DUPLICATE_OLD_ID, title: "Duplicate", summary: "same text", status: "active", updatedAt: OLD }),
  );
  await store.upsertEntry(
    entry({ id: DUPLICATE_NEW_ID, title: "Duplicate", summary: "same text", status: "active", updatedAt: RECENT }),
  );
  await store.upsertEntry(
    entry({ id: REVIEW_ENTRY_ID, type: "decision", title: "Review old decision", status: "active", updatedAt: OLD }),
  );
  await store.upsertSource(source(ARCHIVE_ENTRY_ID));
  await store.upsertSource(source(DUPLICATE_OLD_ID));
  await store.upsertSource(source(DUPLICATE_NEW_ID));
  await store.upsertSource(source(REVIEW_ENTRY_ID));
}

describe("project_memory_maintain tool", () => {
  it("defaults to a manual dry-run and does not mutate project memory", async () => {
    await seedMaintenanceCandidates();

    const output = await executeMaintain({});

    expect(output).toContain("## Project memory maintenance plan");
    expect(output).toContain("- **Dry run:** true");
    expect(output).toContain("| Entry ID | Action | Kind | Safe | Reason |");
    expect(await store.loadEntry(identity.projectId, ARCHIVE_ENTRY_ID)).toMatchObject({ status: "deprecated" });
    expect(await store.loadEntry(identity.projectId, DUPLICATE_OLD_ID)).toMatchObject({ status: "active" });
    expect(await readMaintenanceJournal(identity.projectId)).toEqual([]);
  });

  it("applies safe archive and supersede actions when dry_run is false", async () => {
    await seedMaintenanceCandidates();

    const output = await executeMaintain({ dry_run: false });

    expect(output).toContain("## Project memory maintenance applied");
    expect(output).toContain(`- **Applied:** ${EXPECTED_APPLIED}`);
    expect(output).toContain("- **Skipped:** 0");
    expect(output).toContain("- **Blocked:** 1");
    expect(output).toContain("- **Journal:** `");
    expect(await store.loadEntry(identity.projectId, ARCHIVE_ENTRY_ID)).toMatchObject({ status: "archived" });
    expect(await store.loadEntry(identity.projectId, DUPLICATE_OLD_ID)).toMatchObject({ status: "superseded" });
    expect(await store.loadEntry(identity.projectId, REVIEW_ENTRY_ID)).toMatchObject({ status: "active" });
    expect(await readMaintenanceJournal(identity.projectId)).toHaveLength(4);
  });

  it("returns a friendly degraded identity error without running the worker", async () => {
    const plainDirectory = join(root, "plain");
    mkdirSync(plainDirectory);
    await seedMaintenanceCandidates();

    const output = await executeMaintain({ dry_run: false }, plainDirectory);

    expect(output).toContain("## Error");
    expect(output.toLowerCase()).toContain("degraded identity");
    expect(output).toContain("Configure a stable git origin or pass an explicit project origin.");
    expect(await store.loadEntry(identity.projectId, ARCHIVE_ENTRY_ID)).toMatchObject({ status: "deprecated" });
  });
});
