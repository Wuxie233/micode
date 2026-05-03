import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireRenameLock, releaseRenameLock } from "@/skill-autopilot/concurrency/rename-lock";

describe("rename-lock", () => {
  it("first acquire succeeds, second fails until release", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-lock-"));
    const a = await acquireRenameLock(join(root, "skillA"));
    expect(a.ok).toBe(true);
    const b = await acquireRenameLock(join(root, "skillA"));
    expect(b.ok).toBe(false);
    if (a.ok) releaseRenameLock(a.lockPath);
    const c = await acquireRenameLock(join(root, "skillA"));
    expect(c.ok).toBe(true);
  });

  it("breaks a stale lock past LOCK_STALE_MS", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-lock-stale-"));
    const a = await acquireRenameLock(join(root, "skillB"), { staleMs: 1 });
    expect(a.ok).toBe(true);
    await Bun.sleep(5);
    const b = await acquireRenameLock(join(root, "skillB"), { staleMs: 1 });
    expect(b.ok).toBe(true);
  });
});
