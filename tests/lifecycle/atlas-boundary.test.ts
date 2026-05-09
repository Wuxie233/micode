import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_PATTERNS = [
  /from\s+["']@\/atlas\/finish-spawn["']/u,
  /from\s+["']@\/atlas\/spawn-receipt-marker["']/u,
  /from\s+["']@\/atlas\/handoff-marker["']/u,
  /from\s+["']@\/agents\/atlas-compiler["']/u,
  /shouldSpawnAgent2\s*\(/u,
  /buildHandoffFromLifecycle\s*\(/u,
  /buildSpawnReceipt\s*\(/u,
  /atlasCompilerAgent/u,
];

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"];

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

describe("lifecycle does not depend on atlas auto-spawn plumbing", () => {
  for (const dir of SCAN_DIRS) {
    it(`${dir} is free of atlas-compiler / finish-spawn references`, () => {
      const files: string[] = [];
      walk(dir, files);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const pat of FORBIDDEN_PATTERNS) {
          expect({ file: f, matched: pat.toString(), hit: pat.test(src) }).toEqual({
            file: f,
            matched: pat.toString(),
            hit: false,
          });
        }
      }
    });
  }

  it("RECONCILE_OWNER no longer says lifecycle-finish", () => {
    const src = readFileSync("src/tools/atlas/init.ts", "utf8");
    expect(src).not.toContain("lifecycle-finish atlas-compiler owns reconcile");
    expect(src).toContain("user-triggered atlas-compiler owns reconcile");
  });
});
