import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { Entity, Entry, Relation, Source, Status } from "@/project-memory/types";
import { StatusValues } from "@/project-memory/types";

const PROJECT_ONE = "project-one";
const PROJECT_TWO = "project-two";
const ENTITY_ID = "entity-one";
const OTHER_ENTITY_ID = "entity-two";
const ENTRY_ID = "entry-one";
const OTHER_ENTRY_ID = "entry-two";
const THIRD_ENTRY_ID = "entry-three";
const SOURCE_ID = "source-one";
const OTHER_SOURCE_ID = "source-two";
const RELATION_ID = "relation-one";
const OTHER_RELATION_ID = "relation-two";
const MANUAL_POINTER = "manual://note";
const PLAN_POINTER = "thoughts/shared/plans/example.md";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const STALE_WINDOW_MS = 1_000_000;
const STALE_MARGIN_MS = 60_000;
const EXPECTED_SINGLE_COUNT = 1;

let dir: string;
let stores: ProjectMemoryStore[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memstore-"));
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
    title: "Use SQLite",
    summary: "alpha bravo memory decision",
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

function relation(overrides: Partial<Relation> = {}): Relation {
  return {
    projectId: PROJECT_ONE,
    id: RELATION_ID,
    fromId: ENTRY_ID,
    toId: OTHER_ENTRY_ID,
    kind: "related",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function dbPath(): string {
  return join(dir, "memory.db");
}

function relationCount(projectId: string): number {
  const database = new Database(dbPath());
  try {
    return (
      database
        .query<{ count: number }, [string]>("SELECT count(*) AS count FROM relations WHERE project_id = ?")
        .get(projectId)?.count ?? 0
    );
  } finally {
    database.close();
  }
}

function statusCounts(active = 0): Record<Status, number> {
  const counts = Object.fromEntries(StatusValues.map((status) => [status, 0])) as Record<Status, number>;
  counts.active = active;
  return counts;
}

describe("ProjectMemoryStore", () => {
  it("loads inserted rows from every table", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Second", summary: "related target" }));
    await store.upsertRelation(relation());
    await store.upsertSource(source());

    expect(await store.loadEntity(PROJECT_ONE, ENTITY_ID)).toEqual(entity());
    expect(await store.loadEntry(PROJECT_ONE, ENTRY_ID)).toEqual(entry());
    expect(await store.loadSourcesForEntry(PROJECT_ONE, ENTRY_ID)).toEqual([source()]);
    expect(relationCount(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countEntities(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countEntries(PROJECT_ONE)).toBe(2);
    expect(await store.countSources(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countMissingSources(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countEntriesByStatus(PROJECT_ONE)).toEqual(statusCounts(2));
  });

  it("returns FTS hits and replaces stale FTS rows on entry upsert", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntry(entry({ title: "Alpha title", summary: "bravo context" }));

    const initial = await store.searchEntries(PROJECT_ONE, "alpha", { limit: 5 });
    expect(initial.map((hit) => hit.entry.id)).toEqual([ENTRY_ID]);
    expect(initial[0]?.score).toBeGreaterThan(0);

    await store.upsertEntry(entry({ title: "Gamma title", summary: "delta context" }));

    expect(await store.searchEntries(PROJECT_ONE, "alpha", { limit: 5 })).toEqual([]);
    expect((await store.searchEntries(PROJECT_ONE, "gamma", { limit: 5 })).map((hit) => hit.entry.id)).toEqual([
      ENTRY_ID,
    ]);
  });

  it("isolates entries by projectId in a shared database", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ projectId: PROJECT_TWO }));
    await store.upsertEntry(entry());

    const hitsOne = await store.searchEntries(PROJECT_ONE, "alpha", { limit: 5 });
    const hitsTwo = await store.searchEntries(PROJECT_TWO, "alpha", { limit: 5 });

    expect(hitsOne.length).toBe(EXPECTED_SINGLE_COUNT);
    expect(hitsTwo).toEqual([]);
    expect(await store.loadEntry(PROJECT_TWO, ENTRY_ID)).toBeNull();
  });

  it("removes a project transactionally without touching another project", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Other", summary: "beta" }));
    await store.upsertSource(source());
    await store.upsertRelation(relation());
    await store.upsertEntity(entity({ projectId: PROJECT_TWO }));
    await store.upsertEntry(entry({ projectId: PROJECT_TWO }));
    await store.upsertSource(source({ projectId: PROJECT_TWO }));
    await store.upsertRelation(relation({ projectId: PROJECT_TWO }));

    await store.forgetProject(PROJECT_ONE);

    expect(await store.countEntities(PROJECT_ONE)).toBe(0);
    expect(await store.countEntries(PROJECT_ONE)).toBe(0);
    expect(await store.countSources(PROJECT_ONE)).toBe(0);
    expect(relationCount(PROJECT_ONE)).toBe(0);
    expect(await store.searchEntries(PROJECT_ONE, "alpha", { limit: 5 })).toEqual([]);
    expect(await store.countEntities(PROJECT_TWO)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countEntries(PROJECT_TWO)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countSources(PROJECT_TWO)).toBe(EXPECTED_SINGLE_COUNT);
    expect(relationCount(PROJECT_TWO)).toBe(EXPECTED_SINGLE_COUNT);
  });

  it("applies structured search filters before ranking", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry({ id: ENTRY_ID, type: "decision", status: "active", sensitivity: "internal" }));
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, type: "risk", status: "deprecated", sensitivity: "internal" }));
    await store.upsertEntry(
      entry({
        id: THIRD_ENTRY_ID,
        entityId: OTHER_ENTITY_ID,
        type: "decision",
        status: "active",
        sensitivity: "secret",
      }),
    );
    await store.upsertEntry(
      entry({ id: "entry-four", entityId: OTHER_ENTITY_ID, type: "note", status: "tentative", sensitivity: "public" }),
    );

    const onlyDecisions = await store.searchEntries(PROJECT_ONE, "alpha", { type: "decision", limit: 10 });
    const onlyActive = await store.searchEntries(PROJECT_ONE, "alpha", { status: "active", limit: 10 });
    const onlyEntity = await store.searchEntries(PROJECT_ONE, "alpha", { entityId: OTHER_ENTITY_ID, limit: 10 });
    const onlyInternal = await store.searchEntries(PROJECT_ONE, "alpha", { sensitivityCeiling: "internal", limit: 10 });
    const onlyPublic = await store.searchEntries(PROJECT_ONE, "alpha", { sensitivityCeiling: "public", limit: 10 });

    expect(onlyDecisions.map((hit) => hit.entry.id).sort()).toEqual([ENTRY_ID, THIRD_ENTRY_ID].sort());
    expect(onlyActive.map((hit) => hit.entry.id).sort()).toEqual([ENTRY_ID, THIRD_ENTRY_ID].sort());
    expect(onlyEntity.map((hit) => hit.entry.id).sort()).toEqual(["entry-four", THIRD_ENTRY_ID].sort());
    expect(onlyInternal.map((hit) => hit.entry.id).sort()).toEqual(["entry-four", ENTRY_ID, OTHER_ENTRY_ID].sort());
    expect(onlyPublic.map((hit) => hit.entry.id)).toEqual(["entry-four"]);
  });

  it("counts missing sources and forgets matching source rows", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Other", summary: "without source" }));
    await store.upsertSource(source({ kind: "design", pointer: PLAN_POINTER }));
    await store.upsertSource(source({ id: OTHER_SOURCE_ID, kind: "plan", pointer: MANUAL_POINTER }));

    expect(await store.countSources(PROJECT_ONE)).toBe(2);
    expect(await store.countMissingSources(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);

    await store.forgetSource(PROJECT_ONE, "design", PLAN_POINTER);
    expect(await store.countSources(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countMissingSources(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);

    await store.forgetSource(PROJECT_ONE, "plan", MANUAL_POINTER);
    expect(await store.countSources(PROJECT_ONE)).toBe(0);
    expect(await store.countMissingSources(PROJECT_ONE)).toBe(2);
  });

  it("counts stale entries older than a threshold by project", async () => {
    const store = createStore();
    const now = Date.now();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ projectId: PROJECT_TWO }));
    await store.upsertEntry(entry({ id: ENTRY_ID, updatedAt: now - STALE_WINDOW_MS - STALE_MARGIN_MS }));
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, updatedAt: now - STALE_WINDOW_MS + STALE_MARGIN_MS }));
    await store.upsertEntry(entry({ projectId: PROJECT_TWO, updatedAt: now - STALE_WINDOW_MS - STALE_MARGIN_MS }));

    expect(await store.countStaleEntries(PROJECT_ONE, STALE_WINDOW_MS)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countStaleEntries(PROJECT_TWO, STALE_WINDOW_MS)).toBe(EXPECTED_SINGLE_COUNT);
  });

  it("forgets an entry with FTS, sources, and referencing relations", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Other", summary: "target" }));
    await store.upsertSource(source());
    await store.upsertRelation(relation());
    await store.upsertRelation(relation({ id: OTHER_RELATION_ID, fromId: OTHER_ENTRY_ID, toId: OTHER_ENTRY_ID }));

    await store.forgetEntry(PROJECT_ONE, ENTRY_ID);

    expect(await store.loadEntry(PROJECT_ONE, ENTRY_ID)).toBeNull();
    expect(await store.loadSourcesForEntry(PROJECT_ONE, ENTRY_ID)).toEqual([]);
    expect(await store.searchEntries(PROJECT_ONE, "alpha", { limit: 5 })).toEqual([]);
    expect(await store.countEntries(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(relationCount(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
  });

  it("forgets an entity and cascades through its entries", async () => {
    const store = createStore();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry());
    await store.upsertEntry(entry({ id: OTHER_ENTRY_ID, title: "Child", summary: "child alpha" }));
    await store.upsertEntry(entry({ id: THIRD_ENTRY_ID, entityId: OTHER_ENTITY_ID, title: "Kept", summary: "kept" }));
    await store.upsertSource(source());
    await store.upsertRelation(relation({ toId: THIRD_ENTRY_ID }));

    await store.forgetEntity(PROJECT_ONE, ENTITY_ID);

    expect(await store.loadEntity(PROJECT_ONE, ENTITY_ID)).toBeNull();
    expect(await store.loadEntry(PROJECT_ONE, ENTRY_ID)).toBeNull();
    expect(await store.loadEntry(PROJECT_ONE, OTHER_ENTRY_ID)).toBeNull();
    expect(await store.loadEntry(PROJECT_ONE, THIRD_ENTRY_ID)).toEqual(
      entry({ id: THIRD_ENTRY_ID, entityId: OTHER_ENTITY_ID, title: "Kept", summary: "kept" }),
    );
    expect(await store.countEntities(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countEntries(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
    expect(await store.countSources(PROJECT_ONE)).toBe(0);
    expect(relationCount(PROJECT_ONE)).toBe(0);
  });

  it("initializes idempotently", async () => {
    const store = createStore();

    await store.initialize();
    await store.initialize();
    await store.upsertEntity(entity());

    expect(await store.countEntities(PROJECT_ONE)).toBe(EXPECTED_SINGLE_COUNT);
  });
});
