import { describe, it, expect } from "bun:test";

describe("background-task response types", () => {
  it("should have SessionCreateResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).toContain("SessionCreateResponse");
  });

  it("should have SessionStatusResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    // We use session.status() API to check task completion, not session.get()
    expect(source).toContain("SessionStatusResponse");
  });

  it("should have SessionMessagesResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).toContain("SessionMessagesResponse");
  });

  it("should use typed responses in manager", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    // Should import the response types
    expect(source).toContain("SessionCreateResponse");
    expect(source).toContain("SessionStatusResponse");
    expect(source).toContain("SessionMessagesResponse");
  });
});
