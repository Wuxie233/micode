import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sweepOrphanStaging } from "@/atlas/staging-sweeper";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-sweep-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("sweepOrphanStaging", () => {
  it("removes orphan staging directories", async () => {
    const stagingDir = join(projectRoot, "atlas", "_meta", "staging", "stale-run");
    mkdirSync(stagingDir, { recursive: true });
    const removed = await sweepOrphanStaging(projectRoot, new Set());
    expect(removed).toEqual(["stale-run"]);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("keeps active runs", async () => {
    const stagingDir = join(projectRoot, "atlas", "_meta", "staging", "live-run");
    mkdirSync(stagingDir, { recursive: true });
    const removed = await sweepOrphanStaging(projectRoot, new Set(["live-run"]));
    expect(removed).toEqual([]);
    expect(existsSync(stagingDir)).toBe(true);
  });

  it("returns empty when staging dir missing", async () => {
    expect(await sweepOrphanStaging(projectRoot, new Set())).toEqual([]);
  });
});
