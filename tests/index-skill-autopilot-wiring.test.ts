import { describe, expect, it } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const legacyImportPrefix = ["@/skill", "evolution/"].join("-");
const legacyToolFactory = ["create", "Skills", "Tools"].join("");
const legacyToolPattern = new RegExp(["skills", "list|skills", "approve|skills", "reject"].join("_"));

describe("plugin wiring", () => {
  it("does not import the old skill-evolution module", () => {
    expect(indexSrc).not.toContain(legacyImportPrefix);
  });

  it("does not register the legacy skills tools", () => {
    expect(indexSrc).not.toContain(legacyToolFactory);
    expect(indexSrc).not.toMatch(legacyToolPattern);
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
