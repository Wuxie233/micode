import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"];

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

const ALLOWED_PROMOTE_SITES = new Set([
  // Single gated call site that respects config.projectMemory.promoteOnLifecycleFinish.
  // promoteFinishedRecord is the ONLY function in lifecycle that may call promoteMarkdown.
  "src/lifecycle/index.ts",
]);

describe("lifecycle does not auto-write Project Memory", () => {
  for (const dir of SCAN_DIRS) {
    it(`${dir} files outside the allowed call site do not import promote*`, () => {
      const files: string[] = [];
      walk(dir, files);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        if (ALLOWED_PROMOTE_SITES.has(f)) continue;
        const src = readFileSync(f, "utf8");
        // Forbidden: any import of promote* from @/project-memory
        const importHit = /import\s+[\s\S]*\bpromote\w*\b[\s\S]*from\s+["']@\/project-memory["']/u.test(src);
        const directCall = /\bpromoteMarkdown\s*\(/u.test(src);
        const promoteTool = /\bproject_memory_promote\s*\(/u.test(src);
        expect({ file: f, importHit, directCall, promoteTool }).toEqual({
          file: f,
          importHit: false,
          directCall: false,
          promoteTool: false,
        });
      }
    });
  }

  it("default config.projectMemory.promoteOnLifecycleFinish is false", () => {
    // This guards the default-flip from being silently reverted.
    const configSrc = readFileSync("src/utils/config.ts", "utf8");
    expect(configSrc).toMatch(/promoteOnLifecycleFinish:\s*false/);
  });

  it("the allowed call site is gated by the config flag", () => {
    // promoteFinishedRecord in src/lifecycle/index.ts MUST guard with the config flag.
    // Without the guard, flipping the default does nothing.
    const indexSrc = readFileSync("src/lifecycle/index.ts", "utf8");
    expect(indexSrc).toContain("config.projectMemory.promoteOnLifecycleFinish");
    // Check that the check appears in a short-circuit return position
    expect(indexSrc).toMatch(/if\s*\([^)]*!config\.projectMemory\.promoteOnLifecycleFinish[^)]*\)\s*return/);
  });

  it("agents Atlas Shared Mental Model section mirrors Project Memory boundary", () => {
    // Cross-check that AGENTS.md documents the project memory lifecycle boundary.
    // Detailed mirror tests live in tests/agents/project-memory-protocol.test.ts; this is a smoke check.
    const agentsMd = readFileSync("AGENTS.md", "utf8");
    expect(agentsMd).toMatch(/Project Memory|项目记忆/);
    expect(agentsMd).toMatch(/lifecycle.*不.*自动.*promote|lifecycle.*does not.*auto.?promote/i);
  });
});
