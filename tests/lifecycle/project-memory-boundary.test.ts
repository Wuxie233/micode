import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"];
const MAINTENANCE_DIR = "src/project-memory/maintenance";

const PROJECT_MEMORY_PROMOTE_TOOL_PATTERN = /\bproject_memory_promote\b/u;
const PROMOTE_MARKDOWN_CALL_PATTERN = /\bpromoteMarkdown\s*\(/u;
const PROMOTE_MARKDOWN_IMPORT_PATTERN = /import\s+[\s\S]*\bpromoteMarkdown\b[\s\S]*from\s+["']@\/project-memory["']/u;
const FORBIDDEN_LIFECYCLE_MAINTENANCE_PATTERNS = [
  /\brunProjectMemoryMaintenance\b/u,
  /from\s+["']@\/project-memory\/maintenance\/(?:classifier|worker)["']/u,
  /from\s+["']\.\.\/project-memory\/maintenance\/(?:classifier|worker)["']/u,
  /from\s+["']\.\.\/\.\.\/project-memory\/maintenance\/(?:classifier|worker)["']/u,
] as const;
const FORBIDDEN_PROJECT_MEMORY_MAINTENANCE_PATTERNS = [
  /\batlas_lookup\b/u,
  /atlas-compiler/u,
  /writeFileSync\(\s*["']atlas/u,
  /\bproject_memory_promote\b/u,
  /\bproject_memory_forget\b/u,
] as const;

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

const ALLOWED_PROMOTE_SITES = new Set<string>();

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

  it("lifecycle has no direct Project Memory promotion call sites", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(dir, files);
    expect(files.length).toBeGreaterThan(0);

    const promoteMarkdownCallSites: string[] = [];
    const promoteMarkdownImportSites: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (PROMOTE_MARKDOWN_CALL_PATTERN.test(src)) promoteMarkdownCallSites.push(f);
      if (PROMOTE_MARKDOWN_IMPORT_PATTERN.test(src)) promoteMarkdownImportSites.push(f);
      expect({ file: f, promoteTool: PROJECT_MEMORY_PROMOTE_TOOL_PATTERN.test(src) }).toEqual({
        file: f,
        promoteTool: false,
      });
    }

    expect(new Set(promoteMarkdownCallSites)).toEqual(ALLOWED_PROMOTE_SITES);
    expect(new Set(promoteMarkdownImportSites)).toEqual(ALLOWED_PROMOTE_SITES);
  });

  it("lifecycle may schedule Project Memory maintenance but not import worker internals", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(dir, files);
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pat of FORBIDDEN_LIFECYCLE_MAINTENANCE_PATTERNS) {
        expect({ file: f, matched: pat.toString(), hit: pat.test(src) }).toEqual({
          file: f,
          matched: pat.toString(),
          hit: false,
        });
      }
    }
  });

  it("Project Memory maintenance does not write Atlas or call MCP memory tools", () => {
    const files: string[] = [];
    walk(MAINTENANCE_DIR, files);
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pat of FORBIDDEN_PROJECT_MEMORY_MAINTENANCE_PATTERNS) {
        expect({ file: f, matched: pat.toString(), hit: pat.test(src) }).toEqual({
          file: f,
          matched: pat.toString(),
          hit: false,
        });
      }
    }
  });

  it("default config.projectMemory.promoteOnLifecycleFinish is false", () => {
    // This guards the default-flip from being silently reverted.
    const configSrc = readFileSync("src/utils/config.ts", "utf8");
    expect(configSrc).toMatch(/promoteOnLifecycleFinish:\s*false/);
  });

  it("the legacy promoteOnLifecycleFinish flag is not used by lifecycle finish", () => {
    const indexSrc = readFileSync("src/lifecycle/index.ts", "utf8");
    expect(indexSrc).not.toContain("promoteOnLifecycleFinish");
    expect(indexSrc).not.toContain("promoteFinishedRecord");
  });

  it("agents Atlas Shared Mental Model section mirrors Project Memory boundary", () => {
    // Cross-check that AGENTS.md documents the project memory lifecycle boundary.
    // Detailed mirror tests live in tests/agents/project-memory-protocol.test.ts; this is a smoke check.
    const agentsMd = readFileSync("AGENTS.md", "utf8");
    expect(agentsMd).toMatch(/Project Memory|项目记忆/);
    expect(agentsMd).toMatch(/lifecycle.*不.*自动.*promote|lifecycle.*does not.*auto.?promote/i);
  });
});
