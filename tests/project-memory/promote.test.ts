import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type PromoteInput, promoteMarkdown } from "@/project-memory/promote";
import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory/store";
import type { SourceKind } from "@/project-memory/types";
import type { ProjectIdentity } from "@/utils/project-id";

const PROJECT_ID = "p1";
const IDENTITY_SOURCE = "origin://repo";
const AUTH_ENTITY = "auth";
const BILLING_ENTITY = "billing";
const SKILL_ENTITY = "skill-2026-05-03";
const LIFECYCLE_POINTER = "thoughts/lifecycle/1.md";
const DESIGN_POINTER = "thoughts/shared/designs/auth.md";
const PLAN_POINTER = "thoughts/shared/plans/auth.md";
const SKILL_POINTER = "skill-candidate://abc123";
const CACHE_DECISION = "Cache for 30s";
const CACHE_MARKDOWN = `## Decisions\n- ${CACHE_DECISION}\n`;
const SKILL_PROCEDURE = "Trigger A; Steps 1-2-3";
const SKILL_MARKDOWN = `## Procedure\n- ${SKILL_PROCEDURE}\n`;
const STRIPE_PREFIX = "sk_live_";
const STRIPE_SUFFIX = "abcdefghijklmnopqrstuvwx";
const SECRET_MARKDOWN = `## Decisions\n- Use API key ${STRIPE_PREFIX}${STRIPE_SUFFIX} for billing\n`;
const EXPECTED_ONE = 1;

let dir: string;
let stores: ProjectMemoryStore[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "promote-"));
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

function identity(kind: ProjectIdentity["kind"] = "origin"): ProjectIdentity {
  return { projectId: PROJECT_ID, kind, source: IDENTITY_SOURCE };
}

function input(store: ProjectMemoryStore, overrides: Partial<PromoteInput> = {}): PromoteInput {
  return {
    store,
    identity: identity(),
    markdown: CACHE_MARKDOWN,
    defaultEntityName: AUTH_ENTITY,
    sourceKind: "lifecycle",
    pointer: LIFECYCLE_POINTER,
    ...overrides,
  };
}

describe("promoteMarkdown", () => {
  it("rejects candidates containing secrets", async () => {
    const store = createStore();
    await store.initialize();

    const result = await promoteMarkdown(
      input(store, { markdown: SECRET_MARKDOWN, defaultEntityName: BILLING_ENTITY }),
    );

    expect(result.refusedReason).toBeNull();
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(EXPECTED_ONE);
    expect(result.rejected[0]?.reason).toBe("secret: stripe_secret_key");
    expect(await store.countEntities(PROJECT_ID)).toBe(0);
    expect(await store.countEntries(PROJECT_ID)).toBe(0);
    expect(await store.countSources(PROJECT_ID)).toBe(0);
  });

  it("refuses durable writes on degraded identity", async () => {
    const store = createStore();
    await store.initialize();

    const result = await promoteMarkdown(input(store, { identity: identity("path") }));

    expect(result).toEqual({ accepted: [], rejected: [], refusedReason: "degraded_identity" });
    expect(await store.countEntities(PROJECT_ID)).toBe(0);
    expect(await store.countEntries(PROJECT_ID)).toBe(0);
    expect(await store.countSources(PROJECT_ID)).toBe(0);
  });

  it("marks design and plan promotions as tentative", async () => {
    const store = createStore();
    await store.initialize();

    const sourceKinds: readonly SourceKind[] = ["design", "plan"];
    const pointers: Record<SourceKind, string> = {
      design: DESIGN_POINTER,
      plan: PLAN_POINTER,
      ledger: "ledger.md",
      lifecycle: LIFECYCLE_POINTER,
      mindmodel: "mindmodel.md",
      manual: "manual.md",
      skill: SKILL_POINTER,
    };

    for (const sourceKind of sourceKinds) {
      const result = await promoteMarkdown(input(store, { sourceKind, pointer: pointers[sourceKind] }));
      expect(result.accepted[0]?.status).toBe("tentative");
      expect(result.rejected).toEqual([]);
    }
  });

  it("creates a tentative procedure entry from a skill markdown body", async () => {
    const store = createStore();
    await store.initialize();

    const result = await promoteMarkdown(
      input(store, {
        markdown: SKILL_MARKDOWN,
        defaultEntityName: SKILL_ENTITY,
        sourceKind: "skill",
        pointer: SKILL_POINTER,
      }),
    );
    const entry = await store.loadEntry(PROJECT_ID, result.accepted[0]?.entryId ?? "");

    expect(result.refusedReason).toBeNull();
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(EXPECTED_ONE);
    expect(result.accepted[0]?.status).toBe("tentative");
    expect(entry).toMatchObject({ type: "procedure", status: "tentative", summary: SKILL_PROCEDURE });
  });

  it("marks lifecycle promotions as active", async () => {
    const store = createStore();
    await store.initialize();

    const result = await promoteMarkdown(input(store));

    expect(result.accepted[0]?.status).toBe("active");
    expect(result.rejected).toEqual([]);
  });

  it("stores entity, entry, and source rows without duplicating a repeated source", async () => {
    const store = createStore();
    await store.initialize();

    const first = await promoteMarkdown(input(store));
    const second = await promoteMarkdown(input(store));
    const entry = await store.loadEntry(PROJECT_ID, first.accepted[0]?.entryId ?? "");
    const entity = entry ? await store.loadEntity(PROJECT_ID, entry.entityId) : null;
    const sources = entry ? await store.loadSourcesForEntry(PROJECT_ID, entry.id) : [];

    expect(second.accepted[0]?.entryId).toBe(first.accepted[0]?.entryId);
    expect(await store.countEntities(PROJECT_ID)).toBe(EXPECTED_ONE);
    expect(await store.countEntries(PROJECT_ID)).toBe(EXPECTED_ONE);
    expect(await store.countSources(PROJECT_ID)).toBe(EXPECTED_ONE);
    expect(entity).toMatchObject({ kind: "module", name: AUTH_ENTITY });
    expect(entry).toMatchObject({
      title: CACHE_DECISION,
      summary: CACHE_DECISION,
      status: "active",
      sensitivity: "internal",
    });
    expect(sources).toMatchObject([{ kind: "lifecycle", pointer: LIFECYCLE_POINTER, excerpt: CACHE_DECISION }]);
  });
});
