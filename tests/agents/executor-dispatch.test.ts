import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

describe("executor domain dispatch", () => {
  it("lists the four domain-specific implementers as available subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('name="implementer-frontend-ui"');
    expect(source).toContain('name="implementer-frontend-code"');
    expect(source).toContain('name="implementer-backend"');
    expect(source).toContain('name="implementer-general"');
  });

  it("no longer lists the old single implementer-frontend as an available subagent", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).not.toContain('name="implementer-frontend"');
  });

  it("declares a domain-dispatch section with a four-row mapping table", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<domain-dispatch");
    expect(source).toContain("<dispatch-table>");
    expect(source).toContain('from="frontend-ui"');
    expect(source).toContain('from="frontend-code"');
    expect(source).toContain('from="backend"');
    expect(source).toContain('from="general"');
  });

  it("does not expose the old single 'frontend' as a from-value in the dispatch table", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).not.toContain('from="frontend" to=');
  });

  it("includes a stale-frontend guard that fails the run on Domain: frontend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<stale-frontend-guard");
    expect(source).toContain("Plan is stale");
    expect(source).toContain("Re-run planner");
  });

  it("defaults to implementer-general when Domain is missing or unrecognized (excluding the stale frontend literal)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<fallback>");
    expect(source).toContain("implementer-general");
    expect(source).toContain("known-stale literal");
  });

  it("forbids spawning the unsuffixed implementer and the old implementer-frontend", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('NEVER spawn agent="implementer"');
    expect(source).toContain('agent="implementer-frontend"');
  });

  it("propagates the Contract path in spawn prompts when plan has one", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<contract-propagation");
    expect(source).toContain("**Contract:**");
    expect(source).toContain("READ FIRST");
  });

  it("includes spawn identity and cleanup guidance", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<spawn-meta");
    expect(source).toContain("cleanup_parent_run");
    expect(source).toContain("Generation fence");
  });

  it("prompt includes spawn-meta identity guidance", () => {
    expect(executorAgent.prompt).toContain("<spawn-meta");
    expect(executorAgent.prompt).toContain("cleanup_parent_run");
    expect(executorAgent.prompt).toContain("Generation fence");
  });

  it("forbids editing the contract on behalf of implementers", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("NEVER edit the contract");
  });

  it("execution example demonstrates dispatch to both new frontend agents and backend/general", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('agent="implementer-frontend-ui"');
    expect(source).toContain('agent="implementer-frontend-code"');
    expect(source).toContain('agent="implementer-backend"');
    expect(source).toContain('agent="implementer-general"');
  });
});
