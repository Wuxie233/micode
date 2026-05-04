import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteSkill } from "@/skill-autopilot/writer/atomic-write";

describe("atomicWriteSkill", () => {
  it("writes when no existing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-aw-"));
    const target = join(dir, "SKILL.md");
    const r = await atomicWriteSkill({ targetPath: target, content: "hello", expectedVersion: null });
    expect(r.ok).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("hello");
  });

  it("succeeds when expectedVersion matches on-disk frontmatter version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-aw2-"));
    const target = join(dir, "SKILL.md");
    writeFileSync(target, "---\nname: x\ndescription: d\nversion: 1\n---\nbody");
    const r = await atomicWriteSkill({ targetPath: target, content: "new", expectedVersion: 1 });
    expect(r.ok).toBe(true);
  });

  it("aborts on CAS mismatch (user edited the file)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-aw3-"));
    const target = join(dir, "SKILL.md");
    writeFileSync(target, "---\nname: x\ndescription: d\nversion: 5\n---\nbody");
    const r = await atomicWriteSkill({ targetPath: target, content: "new", expectedVersion: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/concurrent_edit_skipped/);
  });
});
