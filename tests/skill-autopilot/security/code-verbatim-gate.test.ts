import { describe, expect, it } from "bun:test";

import { codeVerbatimGate } from "@/skill-autopilot/security/code-verbatim-gate";

function inp(body: string) {
  return { name: "n", description: "d", trigger: "t", steps: ["s"], body, frontmatter: { name: "n" } };
}

describe("codeVerbatimGate", () => {
  it("passes a small fenced block", () => {
    expect(codeVerbatimGate(inp("```\nbun test\n```\n")).ok).toBe(true);
  });

  it("rejects a long fenced block", () => {
    const big = ["```", "a", "b", "c", "d", "e", "f", "```"].join("\n");
    expect(codeVerbatimGate(inp(big)).ok).toBe(false);
  });
});
