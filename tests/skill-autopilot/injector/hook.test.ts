import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildInjectionBlock } from "@/skill-autopilot/injector/hook";

const skill = (sens: string, scope: readonly string[]) => `---
name: lint
description: Run lint
version: 1
x-micode-managed: true
x-micode-sensitivity: ${sens}
x-micode-agent-scope:
${scope.map((s) => `  - ${s}`).join("\n")}
x-micode-hits: 5
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

function setup(content: string, name = "lint"): string {
  const root = mkdtempSync(join(tmpdir(), "sa-inj-"));
  const skillsDir = join(root, ".opencode/skills", name);
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, "SKILL.md"), content);
  return root;
}

describe("buildInjectionBlock", () => {
  it("returns null when no skills match the agent role", async () => {
    const root = setup(skill("public", ["reviewer"]));
    const out = await buildInjectionBlock({ cwd: root, agent: "implementer-general" });
    expect(out).toBeNull();
  });

  it("returns a block when scope and sensitivity match", async () => {
    const root = setup(skill("public", ["implementer-general"]));
    const out = await buildInjectionBlock({ cwd: root, agent: "implementer-general" });
    expect(out).not.toBeNull();
    expect(out).toContain("lint");
  });

  it("filters out skills above the sensitivity ceiling", async () => {
    const root = setup(skill("secret", ["implementer-general"]));
    const out = await buildInjectionBlock({ cwd: root, agent: "implementer-general" });
    expect(out).toBeNull();
  });

  it("HTML-escapes injected content", async () => {
    const root = setup(skill("public", ["implementer-general"]).replace("Run lint", "Run <script>alert(1)</script>"));
    const out = await buildInjectionBlock({ cwd: root, agent: "implementer-general" });
    expect(out ?? "").not.toContain("<script>");
  });
});
