import { describe, expect, it } from "bun:test";

describe("executor domain dispatch", () => {
  it("lists the three domain-specific implementers as available subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('name="implementer-frontend"');
    expect(source).toContain('name="implementer-backend"');
    expect(source).toContain('name="implementer-general"');
  });

  it("declares a domain-dispatch section with a mapping table", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<domain-dispatch");
    expect(source).toContain("<dispatch-table>");
    expect(source).toContain('from="frontend"');
    expect(source).toContain('from="backend"');
    expect(source).toContain('from="general"');
  });

  it("defaults to implementer-general when Domain is missing or unrecognized", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<fallback>");
    expect(source).toContain("implementer-general");
  });

  it("forbids spawning the unsuffixed implementer", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('NEVER spawn agent="implementer" (unsuffixed)');
  });

  it("propagates the Contract path in spawn prompts when plan has one", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<contract-propagation");
    expect(source).toContain("**Contract:**");
    expect(source).toContain("READ FIRST");
  });

  it("forbids editing the contract on behalf of implementers", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("NEVER edit the contract");
  });

  it("execution example demonstrates mixed-domain dispatch", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('agent="implementer-frontend"');
    expect(source).toContain('agent="implementer-backend"');
    expect(source).toContain('agent="implementer-general"');
  });
});
