import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeChallenge } from "@/atlas/challenge-writer";
import { detectHumanEdit } from "@/atlas/mtime-detect";
import { runAtlasInit } from "@/tools/atlas/init";
import { runAtlasRefresh } from "@/tools/atlas/refresh";
import { runAtlasStatus } from "@/tools/atlas/status";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-e2e-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("atlas end-to-end", () => {
  it("init -> refresh -> status produces a clean vault and zero broken counts", async () => {
    const init = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(init.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "atlas-phase-roadmap.md"))).toBe(true);
    expect(readFileSync(join(projectRoot, "atlas", "_meta", "schema-version"), "utf8").trim()).toBe("1");

    const refresh = await runAtlasRefresh({ projectRoot, target: "10-impl/runner" });
    expect(refresh.outcome).toBe("ok");

    const status = await runAtlasStatus({ projectRoot });
    expect(status.openChallenges).toBe(0);
    expect(status.brokenWikilinks).toBe(0);
    expect(status.orphanStagingDirs).toBe(0);
    expect(status.lastSuccessfulRun).not.toBe(null);
  });

  it("a written challenge appears in /atlas-status open count", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    await writeChallenge(projectRoot, {
      target: "10-impl/runner.md",
      reason: "I see drift",
      proposedChange: "I would update X to Y",
      sources: ["lifecycle:26"],
      runId: "agent2-26-100",
    });
    const status = await runAtlasStatus({ projectRoot });
    expect(status.openChallenges).toBe(1);
  });

  it("rejects /atlas-init on existing vault without flag", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const second = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(second.outcome).toBe("rejected");
  });

  it("mtime detector flags a hand-edited node", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const path = join(projectRoot, "atlas", "00-index.md");
    const before = statSync(path).mtimeMs;
    expect(before).toBeGreaterThan(0);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n\nhuman edit\n`, "utf8");
    const editedAt = new Date(before + 1000);
    utimesSync(path, editedAt, editedAt);
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(true);
  });
});
