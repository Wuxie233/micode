import { describe, expect, it } from "bun:test";

import { lengthGate } from "@/skill-autopilot/security/length-gate";

function inp(body: string, steps: readonly string[]) {
  return { name: "n", description: "d", trigger: "t", steps, body, frontmatter: { name: "n" } };
}

describe("lengthGate", () => {
  it("passes when under all caps", () => {
    expect(lengthGate(inp("ok", ["a", "b"])).ok).toBe(true);
  });

  it("rejects when body exceeds bodyMaxBytes", () => {
    const big = "a".repeat(20_000);
    expect(lengthGate(inp(big, ["a"])).ok).toBe(false);
  });

  it("rejects when steps exceed maxStepsPerSkill", () => {
    const many = Array.from({ length: 50 }, (_, i) => `step ${i}`);
    expect(lengthGate(inp("ok", many)).ok).toBe(false);
  });
});
