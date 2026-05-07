import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("project AGENTS.md: User-Triggered Specialist Agents section", () => {
  it("declares the section heading", () => {
    expect(AGENTS_MD).toMatch(/##\s+User-Triggered Specialist Agents/);
  });

  it("names all five specialist agent ids", () => {
    expect(AGENTS_MD).toContain("product-manager");
    expect(AGENTS_MD).toContain("software-architect");
    expect(AGENTS_MD).toContain("ux-designer");
    expect(AGENTS_MD).toContain("architecture-quality-inspector");
    expect(AGENTS_MD).toContain("rubric-reviewer");
  });

  it("declares the user-triggered, never-auto-spawn rule", () => {
    const lower = AGENTS_MD.toLowerCase();
    expect(lower).toContain("user-triggered");
    expect(lower).toMatch(/never\s+auto.?spawn|不\s*自动\s*派|never\s+default-?run/);
  });

  it("declares the at-most-once-per-phase suggestion cap", () => {
    expect(AGENTS_MD).toMatch(/at most.*once.*phase|每阶段.*最多.*一次|once per phase/i);
  });

  it("excludes specialists from output-class routing", () => {
    const lower = AGENTS_MD.toLowerCase();
    expect(lower).toMatch(/not.*output.?class|不.*output.?class|excluded.*output.?class/);
  });
});
