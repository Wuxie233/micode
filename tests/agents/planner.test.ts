// COMPLETE test code - copy-paste ready
// Replaces the contents of tests/agents/planner.test.ts
import { describe, expect, it } from "bun:test";

describe("planner agent", () => {
  it("should use spawn_agent tool for subagent research", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("spawn_agent tool");
    expect(source).toContain('agent="codebase-locator"');
  });

  it("should have parallel research documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("parallel");
  });

  it("should enforce synchronous spawn_agent usage", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("synchronously");
  });

  it("should mention running library research in parallel with agents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("context7");
    expect(source).toContain("btca_ask");
  });

  it("should declare the skeleton-then-fill write protocol", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<write-protocol>");
    expect(source).toContain("</write-protocol>");
  });

  it("should embed BATCH placeholder markers in the skeleton template", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<!-- BATCH-N-TASKS -->");
  });

  it("should mandate one Edit call per batch", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("One Edit per batch");
  });

  it("should declare a resume rule for partially-filled plan files", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<resume-rule>");
    expect(source).toContain("</resume-rule>");
  });

  it("should forbid re-editing already-filled batches", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("Never re-Edit a batch that has already been filled");
  });

  it("should forbid using Write to overwrite a partially-filled file", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("Never use Write to overwrite a partially-filled file");
  });

  it("should declare the skeleton-first principle", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("skeleton-first");
    expect(source).toContain("one-edit-per-batch");
  });

  it("should document the oversize-task escape hatch", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("BATCH-N-TASK-Y");
  });

  it("should require a behavior commitment mapping section before dependency graph", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain(
      '<behavior-mapping-rules priority="critical" description="BDD 防漂移层：plan.md 必须在文件开头含 ## 行为承诺映射 段">',
    );
    expect(source).toContain("## 行为承诺映射");
    expect(source).toContain("**未对应任何 task 的行为**");

    const mappingIndex = source.indexOf("## 行为承诺映射");
    const dependencyGraphIndex = source.indexOf("## Dependency Graph");
    expect(mappingIndex).toBeGreaterThan(0);
    expect(dependencyGraphIndex).toBeGreaterThan(mappingIndex);
  });

  it("should instruct planner to atlas_lookup behavior nodes after reading Behavior", async () => {
    const { plannerAgent } = await import("../../src/agents/planner");
    const prompt = plannerAgent.prompt ?? "";

    expect(prompt).toContain("如果 design 含 `## Behavior` 段");
    expect(prompt).toContain("立即 `atlas_lookup` 查相关 atlas/20-behavior 节点");
  });

  it("should still parse as a valid module and export plannerAgent", async () => {
    const mod = await import("../../src/agents/planner");
    expect(mod.plannerAgent).toBeDefined();
    expect(mod.plannerAgent.mode).toBe("subagent");
    expect(typeof mod.plannerAgent.prompt).toBe("string");
    expect(mod.plannerAgent.prompt.length).toBeGreaterThan(0);
  });
});
