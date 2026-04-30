import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lookup } from "@/project-memory/lookup";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { Entity, Entry, Source } from "@/project-memory/types";
import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";

const PROJECT_ID = "project-lookup";
const ENTITY_ID = "entity-auth";
const OTHER_ENTITY_ID = "entity-billing";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const LIMIT = 10;
const EXPECTED_SINGLE_COUNT = 1;
const SOURCE_PREFIX = "source-";
const POINTER_PREFIX = "manual://";
const LOOKUP_TEST_TIMEOUT_MS = 20_000;

const IDENTITY: ProjectIdentity = {
  projectId: PROJECT_ID,
  kind: "origin",
  source: "github.com/wuxie233/micode",
};

let dir: string;
let stores: ProjectMemoryStore[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lookup-"));
  stores = [];
});

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  rmSync(dir, { recursive: true, force: true });
});

interface SeedInput {
  readonly entity?: Partial<Entity>;
  readonly entry?: Partial<Entry>;
  readonly source?: Partial<Source> | null;
}

function createStore(): ProjectMemoryStore {
  const store = createProjectMemoryStore({ dbDir: dir });
  stores.push(store);
  return store;
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: PROJECT_ID,
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
    projectId: PROJECT_ID,
    id: "entry-default",
    entityId: ENTITY_ID,
    type: "decision",
    title: "Project memory alpha",
    summary: "alpha project memory lookup",
    status: "active",
    sensitivity: "internal",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function sourceFor(entryId: string, overrides: Partial<Source> = {}): Source {
  return {
    projectId: PROJECT_ID,
    id: `${SOURCE_PREFIX}${entryId}`,
    entryId,
    kind: "manual",
    pointer: `${POINTER_PREFIX}${entryId}`,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

async function seedMemory(store: ProjectMemoryStore, input: SeedInput = {}): Promise<Entry> {
  const storedEntity = entity(input.entity);
  const storedEntry = entry({ entityId: storedEntity.id, ...input.entry });

  await store.upsertEntity(storedEntity);
  await store.upsertEntry(storedEntry);
  if (input.source !== null) await store.upsertSource(sourceFor(storedEntry.id, input.source));

  return storedEntry;
}

function hitIds(hits: readonly { readonly entry: Entry }[]): string[] {
  return hits.map((hit) => hit.entry.id);
}

describe("lookup", () => {
  it(
    "applies type, status, and entity filters before ranking through the store",
    async () => {
      const store = createStore();
      await store.initialize();

      await seedMemory(store, { entry: { id: "entry-decision-active", type: "decision", status: "active" } });
      await seedMemory(store, { entry: { id: "entry-risk-active", type: "risk", status: "active" } });
      await seedMemory(store, {
        entity: { id: OTHER_ENTITY_ID, name: "billing" },
        entry: { id: "entry-decision-tentative", type: "decision", status: "tentative" },
      });

      const decisions = await lookup({ store, identity: IDENTITY, query: "alpha", type: "decision", limit: LIMIT });
      const active = await lookup({ store, identity: IDENTITY, query: "alpha", status: "active", limit: LIMIT });
      const billing = await lookup({
        store,
        identity: IDENTITY,
        query: "alpha",
        entityId: OTHER_ENTITY_ID,
        limit: LIMIT,
      });

      expect(hitIds(decisions)).toEqual(["entry-decision-active", "entry-decision-tentative"]);
      expect(hitIds(active).sort()).toEqual(["entry-decision-active", "entry-risk-active"].sort());
      expect(hitIds(billing)).toEqual(["entry-decision-tentative"]);
    },
    LOOKUP_TEST_TIMEOUT_MS,
  );

  it("sorts hits by status rank before score and recency", async () => {
    const store = createStore();
    await store.initialize();

    await seedMemory(store, { entry: { id: "entry-superseded", status: "superseded" } });
    await seedMemory(store, { entry: { id: "entry-deprecated", status: "deprecated" } });
    await seedMemory(store, { entry: { id: "entry-hypothesis", status: "hypothesis" } });
    await seedMemory(store, { entry: { id: "entry-tentative", status: "tentative" } });
    await seedMemory(store, { entry: { id: "entry-active", status: "active" } });

    const hits = await lookup({ store, identity: IDENTITY, query: "alpha", limit: LIMIT });

    expect(hitIds(hits)).toEqual([
      "entry-active",
      "entry-tentative",
      "entry-hypothesis",
      "entry-superseded",
      "entry-deprecated",
    ]);
  });

  it("truncates snippets to the configured maximum", async () => {
    const store = createStore();
    const summary = "alpha ".repeat(config.projectMemory.snippetMaxChars);
    await store.initialize();
    await seedMemory(store, { entry: { id: "entry-long", summary } });

    const hits = await lookup({ store, identity: IDENTITY, query: "alpha" });
    const expected = `${summary.slice(0, config.projectMemory.snippetMaxChars - 1)}…`;

    expect(hits.length).toBe(EXPECTED_SINGLE_COUNT);
    expect(hits[0]?.snippet).toBe(expected);
    expect(hits[0]?.snippet.length).toBe(config.projectMemory.snippetMaxChars);
  });

  it("marks hits as degraded when no sources are attached", async () => {
    const store = createStore();
    await store.initialize();
    await seedMemory(store, { entry: { id: "entry-without-source" }, source: null });

    const hits = await lookup({ store, identity: IDENTITY, query: "alpha" });

    expect(hits.length).toBe(EXPECTED_SINGLE_COUNT);
    expect(hits[0]?.degraded).toBe(true);
    expect(hits[0]?.sources).toEqual([]);
  });

  it("skips hits whose entity is missing", async () => {
    const store = createStore();
    await store.initialize();
    await store.upsertEntry(entry({ id: "entry-orphan" }));

    const hits = await lookup({ store, identity: IDENTITY, query: "alpha" });

    expect(hits).toEqual([]);
  });
});
