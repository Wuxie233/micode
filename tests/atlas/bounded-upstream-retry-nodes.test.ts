import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const ATLAS = resolve(__dirname, "..", "..", "atlas");

async function read(rel: string): Promise<string> {
  return fs.readFile(resolve(ATLAS, rel), "utf8");
}

describe("Atlas nodes for bounded upstream continuation retry", () => {
  test("new 10-impl/workflow-retry.md exists with required sections", async () => {
    const text = await read("10-impl/workflow-retry.md");
    expect(text).toMatch(/title:\s*工作流 Continuation Retry|title:\s*Workflow Continuation Retry/);
    expect(text).toMatch(/upstream-predicate|policy|attempt-registry/);
    expect(text).toMatch(/built-in Task.*executor-direct|executor-direct.*built-in Task/);
    expect(text).toMatch(/session-recovery/);
    expect(text).toMatch(/session\.error|message\.updated|hook event/);
    expect(text).toMatch(/20/);
    expect(text).toMatch(/30/);
  });

  test("new 20-behavior/bounded-upstream-continuation-retry.md exists with behavior commitments", async () => {
    const text = await read("20-behavior/bounded-upstream-continuation-retry.md");
    expect(text).toMatch(/upstream_error/);
    expect(text).toMatch(/continuation|continue|继续/);
    expect(text).toMatch(/session\.error/);
    expect(text).toMatch(/message\.updated/);
    expect(text).toMatch(/hook event|hook 事件/);
    expect(text).toMatch(/TUI-only|TUI only/);
    expect(text).toMatch(/unobservable|不可观测/);
    expect(text).toMatch(/cannot (?:be )?captured|无法捕获/);
    expect(text).toMatch(/20/);
    expect(text).toMatch(/30/);
  });

  test("spawn-agent-tool.md updated to reference the new outer continuation layer", async () => {
    const text = await read("10-impl/spawn-agent-tool.md");
    expect(text).toMatch(/workflow-retry|continuation/i);
    expect(text).toMatch(/45/);
  });

  test("hooks-pipeline.md updated to document session-recovery upstream branch", async () => {
    const text = await read("10-impl/hooks-pipeline.md");
    expect(text.toLowerCase()).toMatch(/upstream|continuation/);
  });

  test("octto-session-system.md updated to document auto-resume bounded retry", async () => {
    const text = await read("10-impl/octto-session-system.md");
    expect(text.toLowerCase()).toMatch(/upstream|continuation/);
  });
});
