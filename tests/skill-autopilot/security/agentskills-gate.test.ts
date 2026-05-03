import { describe, expect, it } from "bun:test";

import { agentskillsGate } from "@/skill-autopilot/security/agentskills-gate";

const body = "## When to Use\nx\n## Procedure\n- s\n## Pitfalls\n- p\n## Verification\n- v\n";

describe("agentskillsGate", () => {
  it("passes when name matches regex and parent dir", () => {
    const r = agentskillsGate(
      { name: "lint", description: "d", trigger: "t", steps: ["s"], body, frontmatter: { name: "lint" } },
      { dirname: "lint" },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects when name does not match parent dir", () => {
    const r = agentskillsGate(
      { name: "lint", description: "d", trigger: "t", steps: ["s"], body, frontmatter: { name: "lint" } },
      { dirname: "test" },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects scripts: field in frontmatter", () => {
    const r = agentskillsGate(
      {
        name: "lint",
        description: "d",
        trigger: "t",
        steps: ["s"],
        body,
        frontmatter: { name: "lint", scripts: ["x.sh"] },
      },
      { dirname: "lint" },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects oversized description (byte level)", () => {
    const big = "啊".repeat(400); // ~1200 bytes
    const r = agentskillsGate(
      { name: "lint", description: big, trigger: "t", steps: ["s"], body, frontmatter: { name: "lint" } },
      { dirname: "lint" },
    );
    expect(r.ok).toBe(false);
  });
});
