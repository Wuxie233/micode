import { describe, expect, it } from "bun:test";

describe("planner contract generation", () => {
  it("includes a contract-generation section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-generation");
    expect(source).toContain("</contract-generation>");
  });

  it("triggers contract only when plan spans both frontend and backend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-trigger>");
    expect(source).toContain("Domain: frontend");
    expect(source).toContain("Domain: backend");
  });

  it("specifies the contract output path and filename pattern", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md");
  });

  it("documents a contract format with HTTP endpoints and TypeScript schemas", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("HTTP Endpoints");
    expect(source).toContain("Request");
    expect(source).toContain("Response");
  });

  it("includes a self-check phase to verify contract consistency", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-self-check>");
  });

  it("declares the contract as frozen once the plan is handed off", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<contract-lifecycle>");
    expect(source).toContain("FROZEN");
  });

  it("plan header template contains a **Contract:** field", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("**Contract:**");
  });

  it("mentions the shared contracts task when shared types are abundant", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("src/shared/contracts.ts");
  });
});
