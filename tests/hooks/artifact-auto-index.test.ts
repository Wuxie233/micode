import { describe, expect, it } from "bun:test";

describe("artifact-auto-index", () => {
  it("should not have handoff pattern or parsing", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).not.toContain("HANDOFF_PATH_PATTERN");
    expect(source).not.toContain("parseHandoff");
    expect(source).not.toContain("indexHandoff");
    expect(source).not.toContain("handoffMatch");
  });

  it("should still have ledger and plan patterns", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).toContain("LEDGER_PATH_PATTERN");
    expect(source).toContain("PLAN_PATH_PATTERN");
    expect(source).toContain("parseLedger");
    expect(source).toContain("parsePlan");
  });

  it("recognizes design files under thoughts/shared/designs", () => {
    const designPattern = /thoughts\/shared\/designs\/(.+)\.md$/;
    const sample = "thoughts/shared/designs/2026-04-28-feature-x-design.md";
    const match = sample.match(designPattern);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("2026-04-28-feature-x-design");
  });

  it("does not recognize non-shared design paths", () => {
    const designPattern = /thoughts\/shared\/designs\/(.+)\.md$/;
    const offPath = "thoughts/lifecycle/something-design.md";
    expect(offPath.match(designPattern)).toBeNull();
  });

  it("indexes designs through the auto-index hook", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).toContain("DESIGN_PATH_PATTERN");
    expect(source).toContain("parseDesign");
  });
});
