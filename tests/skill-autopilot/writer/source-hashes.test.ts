import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeSourceHashes, isStale } from "@/skill-autopilot/writer/source-hashes";

describe("source-hashes", () => {
  it("computes deterministic SHA-256 for files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-sh-"));
    const file = join(dir, "a.md");
    writeFileSync(file, "alpha");
    const hashes = await computeSourceHashes([file]);
    expect(hashes[file]).toMatch(/^[a-f0-9]{64}$/);
    expect(await computeSourceHashes([file])).toEqual(hashes);
    rmSync(dir, { recursive: true, force: true });
  });

  it("isStale returns true when content drifted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-sh2-"));
    const file = join(dir, "b.md");
    writeFileSync(file, "x");
    const before = await computeSourceHashes([file]);
    writeFileSync(file, "y");
    expect(await isStale(before)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("isStale handles deleted source files as stale", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-sh3-"));
    const file = join(dir, "missing.md");
    expect(await isStale({ [file]: "00".repeat(32) })).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
