import { describe, expect, it } from "bun:test";

import { evaluatePushGuard } from "@/skill-autopilot/push-guard";

const skill = (sensitivity: string) => `---
name: x
description: y
version: 1
x-micode-managed: true
x-micode-sensitivity: ${sensitivity}
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

describe("push-guard e2e", () => {
  it("blocks when any of multiple changed files is internal or secret", () => {
    const files: Record<string, string> = {
      "src/index.ts": "// code",
      ".opencode/skills/public/SKILL.md": skill("public"),
      ".opencode/skills/internal/SKILL.md": skill("internal"),
      ".opencode/skills/secret/SKILL.md": skill("secret"),
    };

    const decision = evaluatePushGuard({
      changedPaths: Object.keys(files),
      readFile: (path) => files[path] ?? "",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedPaths).toContain(".opencode/skills/internal/SKILL.md");
    expect(decision.blockedPaths).toContain(".opencode/skills/secret/SKILL.md");
    expect(decision.blockedPaths).not.toContain(".opencode/skills/public/SKILL.md");
    expect(decision.blockedPaths).not.toContain("src/index.ts");
  });

  it("allows when only non-skill files changed", () => {
    const decision = evaluatePushGuard({
      changedPaths: ["src/index.ts", "README.md"],
      readFile: () => "",
    });

    expect(decision.allowed).toBe(true);
  });
});
