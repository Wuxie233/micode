// tests/index.test.ts
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("index.ts constraint-reviewer integration", () => {
  it("should import createConstraintReviewerHook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    expect(source).toContain('from "./hooks/constraint-reviewer"');
    expect(source).toContain("createConstraintReviewerHook");
  });

  it("should create the constraint reviewer hook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be created with a review function
    expect(source).toContain("constraintReviewerHook");
    expect(source).toContain("createConstraintReviewerHook(ctx");
  });

  it("should call constraint reviewer hook in tool.execute.after", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the tool.execute.after handler
    expect(source).toContain('constraintReviewerHook["tool.execute.after"]');
  });

  it("should call constraint reviewer hook in chat.message", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the chat.message handler
    expect(source).toContain('constraintReviewerHook["chat.message"]');
  });

  it("should use mm-constraint-reviewer agent for review", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The review function should use the mm-constraint-reviewer agent
    expect(source).toContain("mm-constraint-reviewer");
  });
});

describe("index.ts /init command", () => {
  it("should use mm-orchestrator agent for /init command", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The /init command should use mm-orchestrator for v2 constraint-guided generation
    // Match the init command configuration block
    const initCommandMatch = source.match(/init:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(initCommandMatch).not.toBeNull();
    expect(initCommandMatch![1]).toBe("mm-orchestrator");
  });

  it("should have /init as alias for /mindmodel", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // Both commands should use the same agent
    const initMatch = source.match(/init:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    const mindmodelMatch = source.match(/mindmodel:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(initMatch).not.toBeNull();
    expect(mindmodelMatch).not.toBeNull();
    expect(initMatch![1]).toBe(mindmodelMatch![1]);
  });
});
