import { describe, expect, it } from "bun:test";

import { evaluatePushGuard } from "@/skill-autopilot/push-guard";

describe("evaluatePushGuard", () => {
  it("allows push when no skill files changed", () => {
    const r = evaluatePushGuard({
      changedPaths: ["src/index.ts"],
      readFile: () => "",
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks push when an internal skill changed", () => {
    const r = evaluatePushGuard({
      changedPaths: [".opencode/skills/lint/SKILL.md"],
      readFile: () => `---
name: lint
description: x
version: 1
x-micode-managed: true
x-micode-sensitivity: internal
---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`,
    });
    expect(r.allowed).toBe(false);
  });

  it("blocks push when a secret skill changed", () => {
    const r = evaluatePushGuard({
      changedPaths: [".opencode/skills/x/SKILL.md"],
      readFile: () => `---
name: x
description: x
version: 1
x-micode-managed: true
x-micode-sensitivity: secret
---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`,
    });
    expect(r.allowed).toBe(false);
  });

  it("allows push when only public skills changed", () => {
    const r = evaluatePushGuard({
      changedPaths: [".opencode/skills/p/SKILL.md"],
      readFile: () => `---
name: p
description: x
version: 1
x-micode-managed: true
x-micode-sensitivity: public
---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`,
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks push when any changed file contains a secret pattern", () => {
    const r = evaluatePushGuard({
      changedPaths: [".opencode/skills/leak/SKILL.md"],
      readFile: () => "AKIAABCDEFGHIJKLMNOP",
    });
    expect(r.allowed).toBe(false);
  });
});
