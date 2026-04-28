import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";
import type { Entity, Entry, Source } from "@/project-memory";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import { createProjectMemoryForgetTool } from "@/tools/project-memory/forget";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { type ProjectIdentity, resolveProjectId } from "@/utils/project-id";

const REMOTE = "https://github.com/Wuxie233/micode.git";
const TOOL_CONTEXT = {} as unknown as ToolContext;
const ENTITY_ID = "entity-one";
const OTHER_ENTITY_ID = "entity-two";
const ENTRY_ID = "entry-one";
const OTHER_ENTRY_ID = "entry-two";
const SOURCE_ID = "source-one";
const OTHER_SOURCE_ID = "source-two";
const MANUAL_POINTER = "manual://note";
const DESIGN_POINTER = "thoughts/shared/designs/example.md";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const PROJECT_PREFIX_LENGTH = 8;

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

let workdir: string;
let dir: string;
let store: ProjectMemoryStore;
let identity: ProjectIdentity;

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "pm-forget-tool-work-"));
  dir = mkdtempSync(join(tmpdir(), "pm-forget-tool-store-"));
  await $`git init -q`.cwd(workdir);
  await $`git remote add origin ${REMOTE}`.cwd(workdir);
  identity = await resolveProjectId(workdir);
  store = createProjectMemoryStore({ dbDir: dir });
  await store.initialize();
  setProjectMemoryStoreForTest(store);
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  rmSync(workdir, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function pluginInput(): PluginInput {
  return { directory: workdir } as unknown as PluginInput;
}

function projectPrefix(): string {
  return identity.projectId.slice(0, PROJECT_PREFIX_LENGTH);
}

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function executeForget(args: unknown): Promise<string> {
  const tools = createProjectMemoryForgetTool(pluginInput());
  const exec = tools.project_memory_forget.execute.bind(tools.project_memory_forget) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: identity.projectId,
    id: ENTITY_ID,
    kind: "module",
    name: "auth",
    summary: "Authentication module",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    projectId: identity.projectId,
    id: ENTRY_ID,
    entityId: ENTITY_ID,
    type: "decision",
    title: "Alpha memory",
    summary: "alpha project memory decision",
    status: "active",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    projectId: identity.projectId,
    id: SOURCE_ID,
    entryId: ENTRY_ID,
    kind: "manual",
    pointer: MANUAL_POINTER,
    excerpt: "manual evidence",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

async function seedEntry(): Promise<void> {
  await store.upsertEntity(entity());
  await store.upsertEntry(entry());
}

describe("project_memory_forget tool", () => {
  it("forgets a project and confirms entry and entity counts", async () => {
    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Other alpha", summary: "alpha other" }));
    await store.upsertSource(source());

    const output = await executeForget({ target: "project" });

    expect(output).toContain(`Removed 2 entries / 2 entities for project ${projectPrefix()}`);
    expect(await store.countEntries(identity.projectId)).toBe(0);
    expect(await store.countEntities(identity.projectId)).toBe(0);
  });

  it("forgets an entity target after validating entity_id", async () => {
    await seedEntry();
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, entityId: OTHER_ENTITY_ID, title: "Other", summary: "alpha" }));

    const missing = await executeForget({ target: "entity" });
    const output = await executeForget({ target: "entity", entity_id: ENTITY_ID });

    expect(missing).toContain("## Error\n\nentity_id is required when target is entity");
    expect(output).toContain(`Removed 1 entity ${ENTITY_ID} for project ${projectPrefix()}`);
    expect(await store.loadEntity(identity.projectId, ENTITY_ID)).toBeNull();
    expect(await store.loadEntry(identity.projectId, ENTRY_ID)).toBeNull();
    expect(await store.loadEntry(identity.projectId, OTHER_ENTRY_ID)).not.toBeNull();
  });

  it("forgets an entry target after validating entry_id", async () => {
    await seedEntry();
    await store.upsertSource(source());

    const missing = await executeForget({ target: "entry" });
    const output = await executeForget({ target: "entry", entry_id: ENTRY_ID });

    expect(missing).toContain("## Error\n\nentry_id is required when target is entry");
    expect(output).toContain(`Removed 1 entry ${ENTRY_ID} for project ${projectPrefix()}`);
    expect(await store.loadEntry(identity.projectId, ENTRY_ID)).toBeNull();
    expect(await store.loadSourcesForEntry(identity.projectId, ENTRY_ID)).toEqual([]);
  });

  it("forgets a source target after validating source_kind and pointer", async () => {
    await seedEntry();
    await store.upsertSource(source({ kind: "design", pointer: DESIGN_POINTER }));
    await store.upsertSource(source({ id: OTHER_SOURCE_ID, kind: "plan" }));

    const missingKind = await executeForget({ target: "source", pointer: DESIGN_POINTER });
    const missingPointer = await executeForget({ target: "source", source_kind: "design" });
    const output = await executeForget({ target: "source", source_kind: "design", pointer: DESIGN_POINTER });

    expect(missingKind).toContain("## Error\n\nsource_kind is required when target is source");
    expect(missingPointer).toContain("## Error\n\npointer is required when target is source");
    expect(output).toContain(`Removed 1 source design ${DESIGN_POINTER} for project ${projectPrefix()}`);
    expect(await store.loadSourcesForEntry(identity.projectId, ENTRY_ID)).toEqual([
      source({ id: OTHER_SOURCE_ID, kind: "plan" }),
    ]);
  });

  it("returns friendly errors when runtime store initialization fails", async () => {
    const fileDir = join(dir, "not-a-directory");
    writeFileSync(fileDir, "not a directory");
    setProjectMemoryStoreForTest(createProjectMemoryStore({ dbDir: fileDir }));

    const output = await executeForget({ target: "project" });

    expect(output.startsWith("## Error\n\n")).toBe(true);
  });
});
