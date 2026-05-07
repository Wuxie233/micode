import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const COUPLING_REUSE_PATH = join(REPO_ROOT, ".mindmodel", "architecture", "coupling-reuse.md");
const MANIFEST_PATH = join(REPO_ROOT, ".mindmodel", "manifest.yaml");
const AGENTS_PATH = join(REPO_ROOT, "AGENTS.md");

describe("coupling-reuse mindmodel constraint", () => {
  it("file exists at the expected path", () => {
    expect(existsSync(COUPLING_REUSE_PATH)).toBe(true);
  });

  it("contains the four core philosophy keywords", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8");
    expect(content).toContain("低耦合");
    expect(content).toContain("模块化");
    expect(content).toContain("复用");
    expect(content).toContain("轮子");
  });

  it("documents the four anti-patterns from the design", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8").toLowerCase();
    expect(content).toMatch(/shotgun.*business|business.*shotgun|散弹.*业务|业务.*散弹/);
    expect(content).toMatch(/utility duplication|工具.*重复|重复.*工具/);
    expect(content).toMatch(/future-proof|过度抽象|future.*abstraction/);
    expect(content).toMatch(/private[-\s]?state|私有状态/);
  });

  it("references the three usage stages: brainstormer/architect, planner, reviewer", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8").toLowerCase();
    expect(content).toContain("brainstormer");
    expect(content).toContain("planner");
    expect(content).toContain("reviewer");
  });

  it("is registered in .mindmodel/manifest.yaml under the architecture group", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toContain("architecture/coupling-reuse.md");
    const couplingBlock = manifest.match(/-\s*path:\s*architecture\/coupling-reuse\.md[\s\S]*?group:\s*architecture/);
    expect(couplingBlock).not.toBeNull();
  });

  it("is referenced from project AGENTS.md as the single source", () => {
    expect(existsSync(AGENTS_PATH)).toBe(true);
    const agents = readFileSync(AGENTS_PATH, "utf-8");
    expect(agents).toContain(".mindmodel/architecture/coupling-reuse.md");
  });
});
