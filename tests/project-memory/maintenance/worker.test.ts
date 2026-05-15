import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMaintenanceJournal } from "@/project-memory/maintenance/journal";
import { acquireMaintenanceLock } from "@/project-memory/maintenance/lock";
import { runProjectMemoryMaintenance } from "@/project-memory/maintenance/worker";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { Entity, Entry, Source } from "@/project-memory/types";
import type { ProjectIdentity } from "@/utils/project-id";

const PROJECT_ID = "project-worker";
const ENTITY_ID = "entity-worker";
const ENTRY_ID = "entry-worker";
const NOW = 1_000_000;
const OLD = 1;

const IDENTITY: ProjectIdentity = {
  projectId: PROJECT_ID,
  kind: "origin",
  source: "github.com/wuxie233/micode",
};

let root: string;
let store: ProjectMemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "memworker-"));
  store = createProjectMemoryStore({ dbDir: join(root, "db") });
  await store.initialize();
  await store.upsertEntity(entity());
});

afterEach(async () => {
  await store.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
});

function journalDir(): string {
  return join(root, "journal");
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    projectId: PROJECT_ID,
    id: ENTITY_ID,
    kind: "module",
    name: "worker",
    summary: "Maintenance worker",
    createdAt: OLD,
    updatedAt: NOW,
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    projectId: PROJECT_ID,
    id: ENTRY_ID,
    entityId: ENTITY_ID,
    type: "note",
    title: "Worker note",
    summary: "Useful project memory note.",
    status: "active",
    sensitivity: "internal",
    createdAt: OLD,
    updatedAt: NOW,
    ...overrides,
  };
}

function source(entryId: string): Source {
  return {
    projectId: PROJECT_ID,
    id: `source_${entryId}`,
    entryId,
    kind: "manual",
    pointer: `manual://${entryId}`,
    createdAt: NOW,
  };
}

function runInput(
  overrides: Partial<Parameters<typeof runProjectMemoryMaintenance>[0]> = {},
): Parameters<typeof runProjectMemoryMaintenance>[0] {
  return {
    projectId: PROJECT_ID,
    reason: "scheduled",
    dryRun: false,
    triggeredBy: "test",
    store,
    identity: IDENTITY,
    journalDir: journalDir(),
    now: NOW,
    ...overrides,
  };
}

describe("project-memory maintenance worker", () => {
  it("returns a dry-run plan and journal without mutating entries", async () => {
    await store.upsertEntry(entry({ id: "entry_note", type: "note" }));

    const outcome = await runProjectMemoryMaintenance(runInput({ dryRun: true, reason: "dry-run" }));

    expect(outcome.applied).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(outcome.blocked).toBe(0);
    expect(outcome.plan.items.map((item) => item.entryId)).toEqual(["entry_note"]);
    expect((await store.loadEntry(PROJECT_ID, "entry_note"))?.status).toBe("active");
    expect((await readMaintenanceJournal(PROJECT_ID, { dir: journalDir() }))[0]).toMatchObject({
      action: "skip",
      counts: { planned: 1, applied: 0, skipped: 1, blocked: 0 },
    });
  });

  it("supersedes the older duplicate entry while keeping the newest active", async () => {
    await store.upsertEntry(entry({ id: "entry_old", updatedAt: OLD }));
    await store.upsertEntry(entry({ id: "entry_new", updatedAt: NOW }));
    await store.upsertSource(source("entry_new"));

    const outcome = await runProjectMemoryMaintenance(runInput());

    expect(outcome.applied).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect((await store.loadEntry(PROJECT_ID, "entry_old"))?.status).toBe("superseded");
    expect((await store.loadEntry(PROJECT_ID, "entry_new"))?.status).toBe("active");
  });

  it("keeps missing-source decisions for review instead of hard deleting them", async () => {
    await store.upsertEntry(entry({ id: "entry_decision", type: "decision" }));

    const outcome = await runProjectMemoryMaintenance(runInput());

    expect(outcome.applied).toBe(0);
    expect(outcome.blocked).toBe(1);
    expect((await store.loadEntry(PROJECT_ID, "entry_decision"))?.status).toBe("active");
    expect(outcome.plan.items[0]).toMatchObject({ action: "needs_review", safeByDefault: false });
  });

  it("hard deletes potential secrets without leaking the secret into the journal", async () => {
    const secretValue = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    await store.upsertEntry(entry({ id: "entry_secret", title: `leaked token=${secretValue}` }));
    await store.upsertSource(source("entry_secret"));

    const outcome = await runProjectMemoryMaintenance(runInput());
    const journal = await readMaintenanceJournal(PROJECT_ID, { dir: journalDir() });

    expect(outcome.applied).toBe(1);
    expect(await store.loadEntry(PROJECT_ID, "entry_secret")).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(secretValue);
    expect(JSON.stringify(journal)).not.toContain(secretValue);
    expect(journal[0]).toMatchObject({ action: "hard_delete_secret", entryIds: ["entry_secret"] });
  });

  it("returns a skipped warning when the project maintenance lock is already held", async () => {
    const lock = await acquireMaintenanceLock(PROJECT_ID);
    try {
      const outcome = await runProjectMemoryMaintenance(runInput());

      expect(outcome.applied).toBe(0);
      expect(outcome.skipped).toBe(1);
      expect(outcome.warnings).toEqual(["project memory maintenance skipped: lock already held"]);
    } finally {
      await lock?.release();
    }
  });

  it("writes a failure journal warning and returns instead of throwing", async () => {
    const failingStore: ProjectMemoryStore = {
      ...store,
      listEntries: async () => {
        throw new Error("snapshot failed");
      },
    };

    const outcome = await runProjectMemoryMaintenance(runInput({ store: failingStore }));
    const journal = await readMaintenanceJournal(PROJECT_ID, { dir: journalDir() });

    expect(outcome.applied).toBe(0);
    expect(outcome.skipped).toBe(0);
    expect(outcome.blocked).toBe(1);
    expect(outcome.warnings).toEqual(["project memory maintenance failed: snapshot failed"]);
    expect(journal[0]).toMatchObject({
      action: "needs_review",
      details: "project memory maintenance failed: snapshot failed",
    });
  });
});
