import { describe, expect, it } from "bun:test";

import { evaluatePushGuard } from "@/skill-autopilot/push-guard";
import { config } from "@/utils/config";

const SKILL_PATH = ".opencode/skills/example/SKILL.md";
const SOURCE_PATH = "src/index.ts";
const NESTED_SKILL_PATH = ".opencode/skills/nested/example/SKILL.md";
const SECRET_TEXT = "AKIAABCDEFGHIJKLMNOP";

function skillFile(sensitivity?: string): string {
  const sensitivityLine = sensitivity === undefined ? "" : `x-micode-sensitivity: ${sensitivity}\n`;
  return `---
name: example
description: x
version: 1
x-micode-managed: true
${sensitivityLine}---
## When to Use
t
## Procedure
- s
## Pitfalls
- p
## Verification
- v
`;
}

describe("evaluatePushGuard", () => {
  it("allows push when no skill files changed", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SOURCE_PATH],
      readFile: () => "",
    });
    expect(decision.allowed).toBe(true);
  });

  it("ignores nested or non-skill paths", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SOURCE_PATH, NESTED_SKILL_PATH],
      readFile: () => {
        throw new Error("should not read ignored paths");
      },
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows push when a skill uses the configured default sensitivity", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => skillFile(),
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows push when all skill sensitivities are on the allow-list", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => skillFile("public"),
    });
    expect(decision.allowed).toBe(true);
  });

  it("blocks push when a skill sensitivity is not on the allow-list", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => skillFile("internal"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedPaths).toEqual([SKILL_PATH]);
    expect(decision.reason).toContain("allowed-sensitivity allow-list");
    expect(decision.reason).toContain(config.skillAutopilot.allowedAutoWriteSensitivities.join(", "));
  });

  it("blocks push when the skill file cannot be read", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => {
        throw new Error("unreadable");
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedPaths).toEqual([SKILL_PATH]);
  });

  it("blocks push when the skill file cannot be parsed", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => "not frontmatter",
    });
    expect(decision.allowed).toBe(false);
  });

  it("blocks push when any changed file contains a secret pattern", () => {
    const decision = evaluatePushGuard({
      changedPaths: [SKILL_PATH],
      readFile: () => SECRET_TEXT,
    });
    expect(decision.allowed).toBe(false);
  });
});
