import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..");
const legacySourceDir = join("src", ["skill", "evolution"].join("-"));
const legacyTestDir = join("tests", ["skill", "evolution"].join("-"));
const legacyHook = join("src", "hooks", ["procedure", "injector.ts"].join("-"));
const legacyTools = join("src", "tools", "skills.ts");
const legacyImportPrefix = ["@/skill", "evolution"].join("-");

describe("legacy skill-evolution module removed", () => {
  it("src/skill-evolution/ no longer exists", () => {
    expect(existsSync(join(repoRoot, legacySourceDir))).toBe(false);
  });

  it("tests/skill-evolution/ no longer exists", () => {
    expect(existsSync(join(repoRoot, legacyTestDir))).toBe(false);
  });

  it("old procedure injector hook is gone", () => {
    expect(existsSync(join(repoRoot, legacyHook))).toBe(false);
  });

  it("old skills tool module is gone", () => {
    expect(existsSync(join(repoRoot, legacyTools))).toBe(false);
  });

  it("no surviving source file references old skill module imports", () => {
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) out.push(p);
      }
      return out;
    }
    const files = walk(join(repoRoot, "src")).concat(walk(join(repoRoot, "tests")));
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(legacyImportPrefix));
    expect(offenders).toEqual([]);
  });
});
