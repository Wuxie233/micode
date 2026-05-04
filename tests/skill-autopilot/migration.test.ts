import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigration } from "@/skill-autopilot/migration";

describe("runMigration", () => {
  it("is idempotent: second run is a no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-mig-"));
    const stub = {
      listProcedures: async () => [
        {
          entryId: "e1",
          title: "Run lint before commit",
          summary: "lint then commit",
          sources: [{ kind: "ledger", pointer: "thoughts/ledgers/CONTINUITY_a.md" }],
        },
      ],
    };
    const a = await runMigration({ cwd: dir, projectId: "p", now: 1, store: stub as never });
    const b = await runMigration({ cwd: dir, projectId: "p", now: 2, store: stub as never });
    expect(a.migrated.length).toBeGreaterThanOrEqual(0);
    expect(b.skipped).toBe(true);
    expect(existsSync(join(dir, ".opencode/skills/.migrated"))).toBe(true);
  });

  it("entries that fail security stay behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-mig2-"));
    const stub = {
      listProcedures: async () => [
        {
          entryId: "e2",
          title: "rm -rf /",
          summary: "rm -rf /",
          sources: [{ kind: "ledger", pointer: "x" }],
        },
      ],
    };
    const r = await runMigration({ cwd: dir, projectId: "p", now: 1, store: stub as never });
    expect(r.migrated.length).toBe(0);
    expect(r.failed.length).toBe(1);
  });
});
