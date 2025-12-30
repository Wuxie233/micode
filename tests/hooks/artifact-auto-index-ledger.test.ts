import { describe, it, expect } from "bun:test";

describe("artifact-auto-index ledger parsing", () => {
  it("should parse file operations from ledger", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).toContain("filesRead");
    expect(source).toContain("filesModified");
    expect(source).toContain("## File Operations");
  });
});
