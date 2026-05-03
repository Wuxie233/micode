import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProcedureInjectorHook } from "@/hooks/procedure-injector";
import { createProjectMemoryStore } from "@/project-memory";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";

const ctx = { directory: process.cwd() } as never;
const TEST_PROJECT_ID = "p";
const TEST_ENTITY_ID = "ent_1";
const TEST_ENTRY_ID = "entry_1";
const TEST_SESSION_ID = "s1";

describe("procedure injector hook", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "proc-inject-"));
  });

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT inject when feature flag is disabled", async () => {
    const hook = createProcedureInjectorHook(ctx, { enabled: false });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: TEST_SESSION_ID }, output);
    expect(output.system).toBe("");
  });

  it("does NOT inject when feature flag is enabled but lookup returns no matches", async () => {
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    setProjectMemoryStoreForTest(store);

    const hook = createProcedureInjectorHook(ctx, { enabled: true, lastUserText: () => "irrelevant" });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: TEST_SESSION_ID }, output);
    expect(output.system ?? "").not.toContain("procedure-context");
    await store.close();
  });

  it("appends a procedure-context block when matches exist within budget", async () => {
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    const now = Date.now();
    await store.upsertEntity({
      projectId: TEST_PROJECT_ID,
      id: TEST_ENTITY_ID,
      kind: "module",
      name: "skill",
      summary: "",
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertEntry({
      projectId: TEST_PROJECT_ID,
      id: TEST_ENTRY_ID,
      entityId: TEST_ENTITY_ID,
      type: "procedure",
      title: "Promote ledger",
      summary: "Trigger; step1; step2; step3",
      status: "tentative",
      sensitivity: "internal",
      createdAt: now,
      updatedAt: now,
    });
    setProjectMemoryStoreForTest(store);

    const hook = createProcedureInjectorHook(ctx, {
      enabled: true,
      lastUserText: () => "Promote ledger",
      identityOverride: { projectId: TEST_PROJECT_ID, kind: "origin", source: "x" },
    });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: TEST_SESSION_ID }, output);
    expect(output.system ?? "").toContain("procedure-context");
    expect(output.system ?? "").toContain("Promote ledger");
    await store.close();
  });

  it("does NOT throw when the lookup throws; output.system is unchanged", async () => {
    const hook = createProcedureInjectorHook(ctx, {
      enabled: true,
      lastUserText: () => "x",
      lookupProcedures: async () => {
        throw new Error("boom");
      },
    });
    const output: { system?: string } = { system: "before" };
    await hook["chat.params"]({ sessionID: TEST_SESSION_ID }, output);
    expect(output.system).toBe("before");
  });
});
