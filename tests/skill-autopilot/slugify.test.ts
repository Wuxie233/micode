import { describe, expect, it } from "bun:test";

import { slugifySkillName } from "@/skill-autopilot/slugify";
import { config } from "@/utils/config";

describe("slugifySkillName", () => {
  it("lowercases and kebab-cases ASCII input", () => {
    expect(slugifySkillName({ trigger: "Run Lint And Tests", existing: new Set() })).toBe("run-lint-and-tests");
  });

  it("collapses non-alphanum and trims to nameMaxChars", () => {
    expect(slugifySkillName({ trigger: "  Hello, World!! 2026  ", existing: new Set() })).toBe("hello-world-2026");
  });

  it("transliterates or strips non-ASCII to keep regex compliance", () => {
    const out = slugifySkillName({ trigger: "前端 lint 流程", existing: new Set() });
    expect(out).toMatch(/^[a-z0-9-]+$/);
    expect(out.length).toBeGreaterThan(0);
  });

  it("appends a numeric suffix on collision", () => {
    expect(slugifySkillName({ trigger: "lint", existing: new Set(["lint"]) })).toBe("lint-2");
    expect(slugifySkillName({ trigger: "lint", existing: new Set(["lint", "lint-2"]) })).toBe("lint-3");
  });

  it("reserves room for a collision suffix at max length", () => {
    const suffix = "-2";
    const base = "a".repeat(config.skillAutopilot.nameMaxChars);
    const out = slugifySkillName({ trigger: base, existing: new Set([base]) });

    expect(out).toBe(`${base.slice(0, config.skillAutopilot.nameMaxChars - suffix.length)}${suffix}`);
    expect(out).not.toBe(base);
    expect(out).toHaveLength(config.skillAutopilot.nameMaxChars);
    expect(out).toMatch(config.skillAutopilot.nameRegex);
  });

  it("falls back to a stable hash when input has zero retainable chars", () => {
    const out = slugifySkillName({ trigger: "!!!", existing: new Set() });
    expect(out).toMatch(/^skill-[a-z0-9]{6,}$/);
  });
});
