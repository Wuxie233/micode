import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const README = resolve(__dirname, "..", "..", "README.md");

describe("README cross-reference for bounded upstream continuation retry", () => {
  test("README mentions bounded upstream continuation or links to the AGENTS.md section", async () => {
    const text = await fs.readFile(README, "utf8");
    expect(text.toLowerCase()).toMatch(/upstream|continuation retry|bounded.*retry/);
  });

  test("README does not contradict the 20x30s numbers", async () => {
    const text = await fs.readFile(README, "utf8");
    // If README documents the policy, the numbers must be present.
    if (/bounded.*retry|continuation retry/i.test(text)) {
      expect(text).toMatch(/20/);
      expect(text).toMatch(/30/);
    }
  });

  test("README points readers to the mirrors, design, behavior node, and exclusions", async () => {
    const text = await fs.readFile(README, "utf8");

    expect(text).toContain("AGENTS.md");
    expect(text).toContain("atlas/20-behavior/bounded-upstream-continuation-retry.md");
    expect(text).toContain("thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md");
    expect(text).toMatch(/spawn_agent.*45/i);
    expect(text).toMatch(/lifecycle/);
    expect(text).toMatch(/resume_subagent/);
  });
});
