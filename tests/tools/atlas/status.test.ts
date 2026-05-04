import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAtlasStatus } from "@/tools/atlas/status";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-status-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasStatus", () => {
  it("returns zeroed counts for an empty project", async () => {
    const result = await runAtlasStatus({ projectRoot });
    expect(result.openChallenges).toBe(0);
    expect(result.brokenWikilinks).toBe(0);
    expect(result.orphanStagingDirs).toBe(0);
    expect(result.staleNodes).toBe(0);
    expect(result.lastSuccessfulRun).toBe(null);
  });

  it("counts open challenge files", async () => {
    const dir = join(projectRoot, "atlas", "_meta", "challenges");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.md"), "---\nstatus: open\n---\nbody", "utf8");
    writeFileSync(join(dir, "y.md"), "---\nstatus: dismissed\n---\nbody", "utf8");
    const result = await runAtlasStatus({ projectRoot });
    expect(result.openChallenges).toBe(1);
  });

  it("reports orphan staging directories", async () => {
    mkdirSync(join(projectRoot, "atlas", "_meta", "staging", "orphan"), { recursive: true });
    const result = await runAtlasStatus({ projectRoot });
    expect(result.orphanStagingDirs).toBe(1);
  });
});
