import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAtlasInit } from "@/tools/atlas/init";

let projectRoot: string;
let consoleLogSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-init-"));
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasInit", () => {
  it("creates the vault skeleton on a fresh project", async () => {
    const result = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(result.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "_meta", "schema-version"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "atlas-phase-roadmap.md"))).toBe(true);
    expect(result.nodesWritten).toBeGreaterThanOrEqual(1);
  });

  it("rejects on an existing vault when no flag passed", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const second = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(second.outcome).toBe("rejected");
    expect(second.reason).toContain("--reconcile or --force-rebuild");
  });

  it("--reconcile produces a dry-run report without writing", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const reconcile = await runAtlasInit({
      projectRoot,
      mode: "reconcile",
      projectName: "demo",
      projectType: "server",
    });
    expect(reconcile.outcome).toBe("dry-run");
    expect(reconcile.report).toBeDefined();
  });

  it("--force-rebuild requires a pre-write git tag (recorded in result)", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const force = await runAtlasInit({
      projectRoot,
      mode: "force-rebuild",
      projectName: "demo",
      projectType: "server",
      gitTag: "atlas/pre-rebuild-1",
    });
    expect(force.outcome).toBe("ok");
    expect(force.gitTag).toBe("atlas/pre-rebuild-1");
  });

  it("--force-rebuild removes the prior vault before running cold init", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const indexPath = join(projectRoot, "atlas", "00-index.md");
    const beforeRebuildIndex = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, `${beforeRebuildIndex}\nLOCAL EDIT`, "utf8");

    const force = await runAtlasInit({
      projectRoot,
      mode: "force-rebuild",
      projectName: "demo",
      projectType: "server",
      gitTag: "atlas/pre-rebuild-1",
    });

    expect(force.outcome).toBe("ok");
    const after = readFileSync(indexPath, "utf8");
    expect(after).not.toContain("LOCAL EDIT");
  });
});
