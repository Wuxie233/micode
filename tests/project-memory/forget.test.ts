import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ForgetTarget, forget } from "@/project-memory/forget";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { Entity, Entry, Source } from "@/project-memory/types";
import type { ProjectIdentity } from "@/utils/project-id";

const PROJECT_ONE = "project-one";
const PROJECT_TWO = "project-two";
const ENTITY_ID = "entity-one";
const OTHER_ENTITY_ID = "entity-two";
const ENTRY_ID = "entry-one";
const OTHER_ENTRY_ID = "entry-two";
const THIRD_ENTRY_ID = "entry-three";
const SOURCE_ID = "source-one";
const OTHER_SOURCE_ID = "source-two";
const MANUAL_POINTER = "manual://note";
const DESIGN_POINTER = "thoughts/shared/designs/example.md";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const REMOVED_SINGLE = 1;
const REMOVED_PROJECT_TOTAL = 5;
const QUERY = "alpha";
const SEARCH_LIMIT = 10;

const identity: ProjectIdentity = {
  projectId: PROJECT_ONE,
  kind: "origin",
  source: "github.com/wuxie233/micode",
};

let dir: string;
let stores: ProjectMemoryStore[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memforget-"));
  stores = [];
});

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  rmSync(dir, { recursive: true, force: true });
});

function createStore(): ProjectMemoryStore {
  const store = createProjectMemoryStore({ dbDir: dir });
  stores.push(store);
  return store;
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: PROJECT_ONE,
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
    projectId: PROJECT_ONE,
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
    projectId: PROJECT_ONE,
    id: SOURCE_ID,
    entryId: ENTRY_ID,
    kind: "manual",
    pointer: MANUAL_POINTER,
    excerpt: "manual evidence",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

async function seedEntry(store: ProjectMemoryStore, projectId: string): Promise<void> {
  await store.upsertEntity(entity({ projectId }));
  await store.upsertEntry(entry({ projectId }));
}

async function searchIds(store: ProjectMemoryStore, projectId: string): Promise<readonly string[]> {
  const hits = await store.searchEntries(projectId, QUERY, { limit: SEARCH_LIMIT });
  return hits.map((hit) => hit.entry.id);
}

describe("forget", () => {
  it("forgets a project through the identity scope and returns the counted total", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Other alpha", summary: "alpha other" }));
    await store.upsertEntry(
      entry({ id: THIRD_ENTRY_ID, entityId: OTHER_ENTITY_ID, title: "Third alpha", summary: "alpha third" }),
    );
    await store.upsertSource(source());
    await seedEntry(store, PROJECT_TWO);

    const target: ForgetTarget = { kind: "project" };
    const outcome = await forget({ store, identity, target });

    expect(outcome).toEqual({ removed: REMOVED_PROJECT_TOTAL, target });
    expect(await store.countEntities(PROJECT_ONE)).toBe(0);
    expect(await store.countEntries(PROJECT_ONE)).toBe(0);
    expect(await store.countSources(PROJECT_ONE)).toBe(0);
    expect(await searchIds(store, PROJECT_ONE)).toEqual([]);
    expect(await store.countEntries(PROJECT_TWO)).toBe(REMOVED_SINGLE);
    expect(await searchIds(store, PROJECT_TWO)).toEqual([ENTRY_ID]);
  });

  it("forgets an entity through the identity scope and clears child FTS rows", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Child alpha", summary: "alpha child" }));
    await store.upsertEntry(
      entry({ id: THIRD_ENTRY_ID, entityId: OTHER_ENTITY_ID, title: "Kept alpha", summary: "alpha kept" }),
    );
    await seedEntry(store, PROJECT_TWO);

    const target: ForgetTarget = { kind: "entity", entityId: ENTITY_ID };
    const outcome = await forget({ store, identity, target });

    expect(outcome).toEqual({ removed: REMOVED_SINGLE, target });
    expect(await store.loadEntity(PROJECT_ONE, ENTITY_ID)).toBeNull();
    expect(await store.loadEntry(PROJECT_ONE, ENTRY_ID)).toBeNull();
    expect(await store.loadEntry(PROJECT_ONE, OTHER_ENTRY_ID)).toBeNull();
    expect(await searchIds(store, PROJECT_ONE)).toEqual([THIRD_ENTRY_ID]);
    expect(await searchIds(store, PROJECT_TWO)).toEqual([ENTRY_ID]);
  });

  it("forgets an entry through the identity scope and deletes its FTS row", async () => {
    const store = createStore();
    await store.initialize();

    await seedEntry(store, PROJECT_ONE);
    await seedEntry(store, PROJECT_TWO);
    await store.upsertSource(source());

    const target: ForgetTarget = { kind: "entry", entryId: ENTRY_ID };
    const outcome = await forget({ store, identity, target });

    expect(outcome).toEqual({ removed: REMOVED_SINGLE, target });
    expect(await store.loadEntry(PROJECT_ONE, ENTRY_ID)).toBeNull();
    expect(await store.loadSourcesForEntry(PROJECT_ONE, ENTRY_ID)).toEqual([]);
    expect(await searchIds(store, PROJECT_ONE)).toEqual([]);
    expect(await searchIds(store, PROJECT_TWO)).toEqual([ENTRY_ID]);
  });

  it("forgets a source through the identity scope without deleting the entry", async () => {
    const store = createStore();
    await store.initialize();

    await seedEntry(store, PROJECT_ONE);
    await seedEntry(store, PROJECT_TWO);
    await store.upsertSource(source({ kind: "design", pointer: DESIGN_POINTER }));
    await store.upsertSource(source({ id: OTHER_SOURCE_ID, kind: "plan" }));
    await store.upsertSource(source({ projectId: PROJECT_TWO, kind: "design", pointer: DESIGN_POINTER }));

    const target: ForgetTarget = { kind: "source", sourceKind: "design", pointer: DESIGN_POINTER };
    const outcome = await forget({ store, identity, target });

    expect(outcome).toEqual({ removed: REMOVED_SINGLE, target });
    expect(await store.countSources(PROJECT_ONE)).toBe(REMOVED_SINGLE);
    expect(await store.countSources(PROJECT_TWO)).toBe(REMOVED_SINGLE);
    expect(await store.loadSourcesForEntry(PROJECT_ONE, ENTRY_ID)).toEqual([
      source({ id: OTHER_SOURCE_ID, kind: "plan" }),
    ]);
    expect(await searchIds(store, PROJECT_ONE)).toEqual([ENTRY_ID]);
  });
});
