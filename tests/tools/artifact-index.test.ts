// tests/tools/artifact-index.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ArtifactIndex", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `artifact-index-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create database on initialization", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    const dbPath = join(testDir, "context.db");
    expect(Bun.file(dbPath).size).toBeGreaterThan(0);

    await index.close();
  });

  it("should index and search plans", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    await index.indexPlan({
      id: "plan-1",
      title: "API Refactoring Plan",
      filePath: "/path/to/plan.md",
      overview: "Refactor REST API to GraphQL",
      approach: "Incremental migration with adapter layer",
    });

    const results = await index.search("GraphQL migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("plan");

    await index.close();
  });

  it("should index and search ledgers", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    await index.indexLedger({
      id: "ledger-1",
      sessionName: "database-migration",
      filePath: "/path/to/ledger.md",
      goal: "Migrate from MySQL to PostgreSQL",
      stateNow: "Schema conversion in progress",
      keyDecisions: "Use pgloader for data migration",
      filesRead: "src/db/schema.ts,src/db/migrations/001.sql",
      filesModified: "src/db/config.ts",
    });

    const results = await index.search("PostgreSQL migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("ledger");

    await index.close();
  });

  it("should index ledger with file operations", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    await index.indexLedger({
      id: "ledger-2",
      sessionName: "feature-work",
      filePath: "/path/to/ledger2.md",
      goal: "Implement new feature",
      filesRead: "src/a.ts,src/b.ts",
      filesModified: "src/c.ts",
    });

    // Verify it was indexed (search should find it)
    const results = await index.search("feature");
    expect(results.length).toBeGreaterThan(0);

    await index.close();
  });
});
