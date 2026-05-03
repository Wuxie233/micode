import { describe, expect, it } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");

describe("plugin wiring", () => {
  it("does not import the old skill-evolution module", () => {
    expect(indexSrc).not.toContain("@/skill-evolution/");
  });

  it("does not register the legacy skills tools", () => {
    expect(indexSrc).not.toContain("createSkillsTools");
    expect(indexSrc).not.toMatch(/skills_list|skills_approve|skills_reject/);
  });

  it("imports runAutopilot from @/skill-autopilot/runner", () => {
    expect(indexSrc).toContain("@/skill-autopilot/runner");
  });

  it("uses features.skillAutopilot, not features.skillEvolution", () => {
    expect(indexSrc).toContain("features?.skillAutopilot");
  });

  it("does not register a /skills slash command (deferred to post-MVP)", () => {
    expect(indexSrc).not.toMatch(/^\s*skills:\s*\{/m);
  });
});
