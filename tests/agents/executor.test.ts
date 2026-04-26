import { describe, expect, it } from "bun:test";

describe("executor agent", () => {
  it("should use spawn_agent tool for subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("spawn_agent tool");
    expect(source).toContain('agent="implementer-');
    expect(source).toContain('agent="reviewer"');
  });

  it("should have parallel execution documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("parallel");
  });

  it("should describe reviewer after implementer", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("reviewer");
    expect(source).toContain("implementer");
  });

  it("should prefer resuming preserved subagent sessions", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain('<resume-handling priority="critical">');
    expect(source).toContain("resume_subagent({ session_id, hint? })");
    expect(source).toContain("SUBAGENT_MAX_RESUMES_PER_SESSION");
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("hard_failure: respawn with a corrected prompt.");
  });
});
