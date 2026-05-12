import { describe, expect, it } from "bun:test";

describe("planner lifecycle recovery guidance", () => {
  it("should include a Recovery hint section in lifecycle output failures", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("### Recovery hint");
  });

  it("should recover stale ambiguous lifecycle candidates before stopping", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("kind=ambiguous");
    expect(source).toContain("stale candidate");
    expect(source).toContain("force_refresh: true");
    expect(source).toContain("retry lifecycle_current");
    expect(source).toContain("max 2 recovery rounds");
  });

  it("should retry safe lifecycle_commit push failures exactly once", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("push_failed");
    expect(source).toContain("safe_to_retry");
    expect(source).toContain("retry lifecycle_commit once");
  });

  it("should hard-forbid destructive or hook-skipping git recovery commands", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("git push --force");
    expect(source).toContain("git push --force-with-lease");
    expect(source).toContain("--no-verify");
    expect(source).toContain("git reset --hard");
  });
});
