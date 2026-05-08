import { describe, expect, it } from "bun:test";

describe("planner domain classification", () => {
  it("includes a domain-classification section in the prompt", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<domain-classification");
    expect(source).toContain("</domain-classification>");
  });

  it("documents all four domain values", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("frontend-ui");
    expect(source).toContain("frontend-code");
    expect(source).toContain("backend");
    expect(source).toContain("general");
  });

  it("does not advertise the old single 'frontend' domain in the documented set", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    // The skeleton template Domain line must list the new four-value set, not the old three.
    expect(source).toContain("**Domain:** frontend-ui | frontend-code | backend | general");
    expect(source).not.toContain("**Domain:** frontend | backend | general");
    // The classification rule line must list the new four-value set.
    expect(source).toContain("frontend-ui | frontend-code | backend | general");
  });

  it("lists concrete signals for both frontend variants and backend classification", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain(".tsx");
    expect(source).toContain(".vue");
    expect(source).toContain("src/api/");
    expect(source).toContain(".sql");
    expect(source).toContain("design-system/");
    expect(source).toContain("hooks/");
  });

  it("includes a frontend tie-breaker rule for ambiguous tasks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<frontend-tiebreaker>");
    expect(source).toContain("frontend-code if correctness");
    expect(source).toContain("frontend-ui if user-visible design quality");
  });

  it("Task template includes a **Domain:** field with the new four-value set", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("**Domain:**");
    expect(source).toContain("frontend-ui | frontend-code | backend | general");
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
