import { describe, expect, it } from "bun:test";

import { schemaGate } from "@/skill-autopilot/security/schema-gate";

const baseBody = `## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`;

describe("schemaGate", () => {
  it("passes a valid skill", () => {
    const r = schemaGate({
      name: "lint-first",
      description: "Run lint before commits",
      trigger: "pre-commit",
      steps: ["a"],
      body: baseBody,
      frontmatter: { name: "lint-first", description: "x", version: 1 },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when frontmatter fails Valibot", () => {
    const r = schemaGate({
      name: "BAD NAME",
      description: "x",
      trigger: "t",
      steps: ["a"],
      body: baseBody,
      frontmatter: { name: "BAD NAME", description: "x", version: 1 },
    });
    expect(r.ok).toBe(false);
  });
});
