import { describe, expect, it } from "bun:test";

import { parseSkillFile, parseSkillFrontmatter } from "@/skill-autopilot/schema";

describe("parseSkillFrontmatter", () => {
  it("accepts a minimal valid frontmatter", () => {
    const r = parseSkillFrontmatter({ name: "lint-and-test", description: "Run lint then tests", version: 1 });
    expect(r.ok).toBe(true);
  });

  it("rejects when name fails the agentskills.io regex", () => {
    const r = parseSkillFrontmatter({ name: "Lint And Test", description: "x", version: 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects description exceeding 1024 bytes (UTF-8)", () => {
    const overflow = "啊".repeat(400); // ~1200 bytes
    const r = parseSkillFrontmatter({ name: "n", description: overflow, version: 1 });
    expect(r.ok).toBe(false);
  });

  it("accepts x-micode-* extension fields", () => {
    const r = parseSkillFrontmatter({
      name: "x",
      description: "y",
      version: 2,
      "x-micode-managed": true,
      "x-micode-sensitivity": "internal",
      "x-micode-agent-scope": ["implementer-general"],
      "x-micode-hits": 3,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when scripts: field is present (agentskills.io disallows scripts in frontmatter)", () => {
    const r = parseSkillFrontmatter({ name: "n", description: "d", version: 1, scripts: ["x.sh"] });
    expect(r.ok).toBe(false);
  });
});

describe("parseSkillFile", () => {
  it("requires all four body sections", () => {
    const r = parseSkillFile(`---
name: x
description: d
version: 1
---

## When to Use
trigger

## Procedure
- step

## Pitfalls
- thing

## Verification
- check
`);
    expect(r.ok).toBe(true);
  });

  it("rejects body missing Verification", () => {
    const r = parseSkillFile(`---
name: x
description: d
version: 1
---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
`);
    expect(r.ok).toBe(false);
  });
});
