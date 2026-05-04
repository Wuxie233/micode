import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const indexPath = join(repoRoot, "src", "index.ts");
const migrationPath = join(repoRoot, "src", "skill-autopilot", "migration.ts");
const removedTestPaths = [
  join(repoRoot, "tests", "skill-autopilot", "migration.test.ts"),
  join(repoRoot, "tests", "skill-autopilot", "integration", "migration.test.ts"),
] as const;
const blockedIndexTerms = [
  "@/skill-autopilot/migration",
  "runMigration",
  "triggerSkillMigration",
  "triggerSkillMigrationIfEnabled",
  "runSkillMigration",
] as const;

describe("no startup skill migration", () => {
  it("does not keep the deleted migration module in src", () => {
    expect(existsSync(migrationPath)).toBe(false);
  });

  it("does not wire startup migration through src/index.ts", () => {
    const indexText = readFileSync(indexPath, "utf8");
    const offenders = blockedIndexTerms.filter((term) => indexText.includes(term));

    expect(offenders).toEqual([]);
  });

  it("does not keep migration regression tests for deleted behavior", () => {
    const existingTests = removedTestPaths.filter((path) => existsSync(path));

    expect(existingTests).toEqual([]);
  });
});
