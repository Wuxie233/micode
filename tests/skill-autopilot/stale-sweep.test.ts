import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStaleSweep } from "@/skill-autopilot/stale-sweep";

describe("runStaleSweep", () => {
  it("flags a skill deprecated when its source file changed", async () => {
    const root = mkdtempSync(join(tmpdir(), "sa-stale-"));
    const src = join(root, "src.md");
    writeFileSync(src, "v1");
    const dir = join(root, ".opencode/skills/x");
    mkdirSync(dir, { recursive: true });
    const before = `---
name: x
description: x
version: 1
x-micode-managed: true
x-micode-source-file-hashes:
  ${src}: ${"00".repeat(32)}
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
    writeFileSync(join(dir, "SKILL.md"), before);
    const r = await runStaleSweep({ cwd: root });
    expect(r.deprecated).toContain("x");
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("x-micode-deprecated: true");
  });
});
