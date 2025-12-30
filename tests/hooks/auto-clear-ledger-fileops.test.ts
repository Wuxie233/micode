import { describe, it, expect } from "bun:test";

describe("auto-clear-ledger file ops integration", () => {
  it("should import file-ops-tracker functions", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/auto-clear-ledger.ts", "utf-8");
    expect(source).toContain('from "./file-ops-tracker"');
    // Uses getFileOps first, then clearFileOps after success (not getAndClearFileOps)
    expect(source).toContain("getFileOps");
    expect(source).toContain("clearFileOps");
    expect(source).toContain("formatFileOpsForPrompt");
  });

  it("should pass file ops to ledger-creator prompt", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/auto-clear-ledger.ts", "utf-8");
    expect(source).toContain("previous-ledger");
    // formatFileOpsForPrompt outputs <file-operations> tag
    expect(source).toContain("formatFileOpsForPrompt(fileOps)");
  });
});
