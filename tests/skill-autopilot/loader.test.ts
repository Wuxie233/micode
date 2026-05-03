import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { activateSkill, discoverSkills } from "@/skill-autopilot/loader";

const validBody = `---
name: lint
description: Run lint before commit
version: 1
x-micode-managed: true
---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`;

function setupSkill(root: string, name: string, content: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

describe("loader", () => {
  it("discovers valid skills with name + description only", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-loader-"));
    setupSkill(root, "lint", validBody);
    const r = await discoverSkills(root);
    expect(r.length).toBe(1);
    expect(r[0]?.name).toBe("lint");
    expect(r[0]?.description).toContain("lint");
  });

  it("excludes files with conflict markers", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-loader2-"));
    setupSkill(root, "broken", `${validBody}\n<<<<<<< HEAD\nconflict\n=======\nconflict2\n>>>>>>> main\n`);
    const r = await discoverSkills(root);
    expect(r.length).toBe(0);
  });

  it("activateSkill returns full parsed file", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-loader3-"));
    setupSkill(root, "lint", validBody);
    const r = await activateSkill(root, "lint");
    expect(r?.sections["When to Use"]).toBe("t");
  });
});
