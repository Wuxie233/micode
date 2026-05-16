import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CAPSULE_RUNTIME_DIRS = ["src/agents/context-capsule"] as const;
const CAPSULE_RUNTIME_FILES = [
  "src/agents/context-capsule-protocol.ts",
  "src/tools/spawn-agent/tool.ts",
  "src/tools/spawn-agent-args.ts",
  "src/tools/resume-subagent.ts",
] as const;
const CAPSULE_MENTION_SCAN_DIRS = ["src/agents", "src/tools"] as const;
const LIFECYCLE_BOUNDARY_SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"] as const;
const LIFECYCLE_BOUNDARY_EXTRA_FILES = ["src/tools/resume-subagent.ts"] as const;

const CAPSULE_MENTION_PATTERN = /\b(?:contextCapsule|Context Capsule|context-capsule|context capsule)\b/iu;
const PROJECT_MEMORY_PROMOTION_PATTERNS = [
  /\bproject_memory_promote\s*\(/u,
  /\bpromoteMarkdown\s*\(/u,
  /from\s+["']@\/project-memory["']/u,
] as const;
const ATLAS_MUTATION_PATTERNS = [
  /\batlasCompilerAgent\b/u,
  /\b(?:write|update|maintain)Atlas\w*\b/u,
  /\b(?:writeFileSync|appendFileSync)\s*\([^\n]*(?:["'`]atlas\/|\batlasPath\b)/u,
] as const;
const ATLAS_LOOKUP_PATTERN = /\batlas_lookup\b/u;
const ATLAS_COMPILER_PATTERN = /\batlas-compiler\b/u;
const RESUME_CAPSULE_SEMANTIC_PATTERNS = [
  /\bcontextCapsule\b/u,
  /\bContextCapsule\b/u,
  /context-capsule/u,
  /applyContextCapsulePrefix/u,
] as const;
const LIFECYCLE_CAPSULE_SEMANTIC_PATTERNS = [
  /\bcontextCapsule\b/u,
  /\bContext Capsule\b/u,
  /<context-capsule\b/u,
] as const;
const NEARBY_LINE_WINDOW = 20;

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

const capsuleRuntimeFiles = (): readonly string[] => {
  const files = [...CAPSULE_RUNTIME_FILES];
  for (const dir of CAPSULE_RUNTIME_DIRS) walk(dir, files);
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
};

const lifecycleBoundaryFiles = (): readonly string[] => {
  const files: string[] = [];
  for (const dir of LIFECYCLE_BOUNDARY_SCAN_DIRS) {
    if (existsSync(dir)) walk(dir, files);
  }
  for (const file of LIFECYCLE_BOUNDARY_EXTRA_FILES) {
    if (existsSync(file)) files.push(file);
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
};

const sourceFilesWithCapsuleMentions = (): readonly string[] => {
  const files: string[] = [];
  for (const dir of CAPSULE_MENTION_SCAN_DIRS) walk(dir, files);
  return files.filter((file) => CAPSULE_MENTION_PATTERN.test(readFileSync(file, "utf8")));
};

const findNearbyMatches = (
  source: string,
  forbiddenPatterns: readonly RegExp[],
): Array<{
  readonly capsuleLine: number;
  readonly forbiddenLine: number;
  readonly matched: string;
  readonly text: string;
}> => {
  const lines = source.split("\n");
  const capsuleLines = lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => CAPSULE_MENTION_PATTERN.test(line))
    .map(({ lineNumber }) => lineNumber);

  const matches: Array<{
    readonly capsuleLine: number;
    readonly forbiddenLine: number;
    readonly matched: string;
    readonly text: string;
  }> = [];
  for (const capsuleLine of capsuleLines) {
    const start = Math.max(1, capsuleLine - NEARBY_LINE_WINDOW);
    const end = Math.min(lines.length, capsuleLine + NEARBY_LINE_WINDOW);
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      const text = lines[lineNumber - 1] ?? "";
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          matches.push({ capsuleLine, forbiddenLine: lineNumber, matched: pattern.toString(), text: text.trim() });
        }
      }
    }
  }
  return matches;
};

const findNearbyAtlasLookupWrites = (
  source: string,
): Array<{
  readonly capsuleLine: number;
  readonly forbiddenLine: number;
  readonly matched: string;
  readonly text: string;
}> =>
  findNearbyMatches(source, [ATLAS_LOOKUP_PATTERN]).filter(
    ({ text }) => !/(?:Do not consult|do NOT have access to the) atlas_lookup/u.test(text),
  );

const findNearbyAtlasCompilerWrites = (
  source: string,
): Array<{
  readonly capsuleLine: number;
  readonly forbiddenLine: number;
  readonly matched: string;
  readonly text: string;
}> =>
  findNearbyMatches(source, [ATLAS_COMPILER_PATTERN]).filter(
    ({ text }) => !/lifecycle 工具仍不 spawn atlas-compiler/u.test(text),
  );

describe("context capsule boundary", () => {
  it("capsule runtime code does not promote Project Memory", () => {
    const files = capsuleRuntimeFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of PROJECT_MEMORY_PROMOTION_PATTERNS) {
        expect({ file, matched: pattern.toString(), hit: pattern.test(src) }).toEqual({
          file,
          matched: pattern.toString(),
          hit: false,
        });
      }
    }
  });

  it("capsule runtime code does not update or maintain Atlas", () => {
    const files = capsuleRuntimeFiles().filter((file) => file !== "src/agents/context-capsule-protocol.ts");
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of ATLAS_MUTATION_PATTERNS) {
        expect({ file, matched: pattern.toString(), hit: pattern.test(src) }).toEqual({
          file,
          matched: pattern.toString(),
          hit: false,
        });
      }
    }
  });

  it("capsule mentions are not adjacent to Project Memory or Atlas write semantics", () => {
    const files = sourceFilesWithCapsuleMentions();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const nearbyProjectMemory = findNearbyMatches(src, PROJECT_MEMORY_PROMOTION_PATTERNS);
      const nearbyAtlasMutation = findNearbyMatches(src, ATLAS_MUTATION_PATTERNS);
      const nearbyAtlasLookupWrites = findNearbyAtlasLookupWrites(src);
      const nearbyAtlasCompilerWrites = findNearbyAtlasCompilerWrites(src);
      expect({
        file,
        nearbyProjectMemory,
        nearbyAtlasMutation,
        nearbyAtlasLookupWrites,
        nearbyAtlasCompilerWrites,
      }).toEqual({
        file,
        nearbyProjectMemory: [],
        nearbyAtlasMutation: [],
        nearbyAtlasLookupWrites: [],
        nearbyAtlasCompilerWrites: [],
      });
    }
  });

  it("protocol explicitly keeps capsules out of durable knowledge and resume semantics", () => {
    const src = readFileSync("src/agents/context-capsule-protocol.ts", "utf8");

    expect(src).toContain("not Project Memory, not Atlas");
    expect(src).toContain("do not promote it to Project Memory");
    expect(src).toContain("do not write it into Atlas");
    expect(src).toContain("Do not extend resume_subagent");
    expect(src).toContain("do not fork live sessions");
    expect(src).toContain("do not change lifecycle recovery semantics");
  });

  it("resume_subagent has no contextCapsule input or replay semantics", () => {
    const src = readFileSync("src/tools/resume-subagent.ts", "utf8");

    for (const pattern of RESUME_CAPSULE_SEMANTIC_PATTERNS) {
      expect({ matched: pattern.toString(), hit: pattern.test(src) }).toEqual({
        matched: pattern.toString(),
        hit: false,
      });
    }
    expect(src).toContain("session_id");
    expect(src).toContain("hint");
  });

  it("lifecycle finish and resume sources have no capsule side effects", () => {
    const files = lifecycleBoundaryFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of LIFECYCLE_CAPSULE_SEMANTIC_PATTERNS) {
        expect({ file, matched: pattern.toString(), hit: pattern.test(src) }).toEqual({
          file,
          matched: pattern.toString(),
          hit: false,
        });
      }
    }
  });
});
