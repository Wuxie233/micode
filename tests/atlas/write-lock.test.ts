import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ATLAS_STALE_LOCK_MS } from "@/atlas/config";
import { acquireWriteLock, releaseWriteLock } from "@/atlas/write-lock";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-lock-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("write lock", () => {
  it("acquires a fresh lock and writes the lock file", async () => {
    const lock = await acquireWriteLock(projectRoot, "run-1");
    expect(lock).not.toBe(null);
    expect(existsSync(lock!.lockFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(lock!.lockFile, "utf8"));
    expect(parsed.runId).toBe("run-1");
    releaseWriteLock(lock!);
    expect(existsSync(lock!.lockFile)).toBe(false);
  });

  it("refuses when another live lock exists", async () => {
    const first = await acquireWriteLock(projectRoot, "run-a");
    expect(first).not.toBe(null);
    const second = await acquireWriteLock(projectRoot, "run-b");
    expect(second).toBe(null);
    releaseWriteLock(first!);
  });

  it("reclaims a stale lock", async () => {
    const lockFile = join(projectRoot, "atlas", "_meta", ".write.lock");
    mkdirSync(dirname(lockFile), { recursive: true });
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999_999_999, runId: "old", acquiredAt: Date.now() - ATLAS_STALE_LOCK_MS - 1000 }),
      "utf8",
    );
    const fresh = await acquireWriteLock(projectRoot, "run-c");
    expect(fresh).not.toBe(null);
    releaseWriteLock(fresh!);
  });
});
