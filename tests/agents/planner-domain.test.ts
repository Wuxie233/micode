import { describe, expect, it } from "bun:test";

describe("planner domain classification", () => {
  it("includes a domain-classification section in the prompt", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<domain-classification");
    expect(source).toContain("</domain-classification>");
  });

  it("documents all three domain values", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("frontend");
    expect(source).toContain("backend");
    expect(source).toContain("general");
  });

  it("lists concrete signals for frontend and backend classification", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain(".tsx");
    expect(source).toContain(".vue");
    expect(source).toContain("src/api/");
    expect(source).toContain(".sql");
  });

  it("Task template includes a **Domain:** field", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("**Domain:**");
    expect(source).toContain("frontend | backend | general");
  });

  it("declares a domain-tagged principle", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain('name="domain-tagged"');
  });

  it("preserves existing design document reference", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("thoughts/shared/designs");
  });
});
