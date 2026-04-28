import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHealthReport } from "@/project-memory/health";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { Entity, Entry, Source, Status } from "@/project-memory/types";
import { StatusValues } from "@/project-memory/types";
import type { ProjectIdentity } from "@/utils/project-id";

const PROJECT_ID = "project-health";
const ENTITY_ID = "entity-health";
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
const DEGRADED_WARNING = "identity_degraded: origin not resolved";

let dir: string;
let stores: ProjectMemoryStore[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memhealth-"));
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

function identity(overrides: Partial<ProjectIdentity> = {}): ProjectIdentity {
  return {
    projectId: PROJECT_ID,
    kind: "origin",
    source: "github.com/wuxie233/micode",
    ...overrides,
  };
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: PROJECT_ID,
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
    projectId: PROJECT_ID,
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

function source(overrides: Partial<Source> = {}): Source {
  return {
    projectId: PROJECT_ID,
    id: SOURCE_ID,
    entryId: ACTIVE_ENTRY_ID,
    kind: "manual",
    pointer: "manual://health",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function statusCounts(overrides: Partial<Record<Status, number>> = {}): Record<Status, number> {
  return {
    ...Object.fromEntries(StatusValues.map((status) => [status, 0])),
    ...overrides,
  } as Record<Status, number>;
}

function staleTimestamp(now: number): number {
  return now - STALE_AGE_DAYS * MS_PER_DAY;
}

function recentTimestamp(now: number): number {
  return now - RECENT_AGE_DAYS * MS_PER_DAY;
}

describe("buildHealthReport", () => {
  it("aggregates store counts with zero-filled statuses and stale entries", async () => {
    const store = createStore();
    const now = Date.now();
    await store.initialize();

    await store.upsertEntity(entity());
    await store.upsertEntity(entity({ id: OTHER_ENTITY_ID, name: "billing" }));
    await store.upsertEntry(entry({ id: ACTIVE_ENTRY_ID, status: "active", updatedAt: recentTimestamp(now) }));
    await store.upsertEntry(entry({ id: TENTATIVE_ENTRY_ID, status: "tentative", updatedAt: staleTimestamp(now) }));
    await store.upsertEntry(
      entry({
        id: DEPRECATED_ENTRY_ID,
        entityId: OTHER_ENTITY_ID,
        status: "deprecated",
        updatedAt: recentTimestamp(now),
      }),
    );
    await store.upsertSource(source());

    const report = await buildHealthReport(store, identity());

    expect(report).toEqual({
      projectId: PROJECT_ID,
      identityKind: "origin",
      entityCount: EXPECTED_TWO,
      entryCount: EXPECTED_THREE,
      entriesByStatus: statusCounts({ active: 1, tentative: 1, deprecated: 1 }),
      staleEntryCount: 1,
      missingSourceCount: EXPECTED_TWO,
      recentUpdates: EXPECTED_TWO,
      warnings: [],
    });
  });

  it("warns when project identity is degraded", async () => {
    const store = createStore();
    await store.initialize();

    const report = await buildHealthReport(store, identity({ kind: "path", source: "/tmp/project" }));

    expect(report.warnings).toEqual([DEGRADED_WARNING]);
    expect(report.identityKind).toBe("path");
  });
});
