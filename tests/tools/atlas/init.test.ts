import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAtlasInit } from "@/tools/atlas/init";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-init-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasInit", () => {
  it("creates the vault skeleton on a fresh project", async () => {
    const result = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(result.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "_meta", "schema-version"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "atlas-phase-roadmap.md"))).toBe(true);
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
});
