import { describe, it, expect } from "bun:test";

describe("project-initializer agent", () => {
  it("should use spawn_agent tool for subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("spawn_agent tool");
    expect(source).toContain('agent="codebase-locator"');
  });

  it("should have parallel execution documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("parallel");
  });
});
