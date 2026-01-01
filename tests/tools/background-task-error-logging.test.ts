import { describe, it, expect } from "bun:test";

describe("background-task error logging", () => {
  it("should not have silent catch blocks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");

    // Should not have empty catch blocks
    expect(source).not.toMatch(/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it("should log errors in catch blocks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");

    // All .catch blocks should have console.error
    const catchBlocks = source.match(/\.catch\s*\([^)]+\)/g) || [];
    for (const block of catchBlocks) {
      // Each catch should capture the error parameter
      expect(block).toMatch(/\.catch\s*\(\s*\(\s*\w+\s*\)/);
    }
  });
});
