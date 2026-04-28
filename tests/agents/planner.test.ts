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

  it("should still parse as a valid module and export plannerAgent", async () => {
    const mod = await import("../../src/agents/planner");
    expect(mod.plannerAgent).toBeDefined();
    expect(mod.plannerAgent.mode).toBe("subagent");
    expect(typeof mod.plannerAgent.prompt).toBe("string");
    expect(mod.plannerAgent.prompt.length).toBeGreaterThan(0);
  });
});
