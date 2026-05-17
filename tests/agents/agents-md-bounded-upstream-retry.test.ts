import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("AGENTS.md Bounded Upstream Continuation Retry section", () => {
  it("section exists with the canonical heading", () => {
    expect(AGENTS_MD).toMatch(/##\s+Bounded Upstream Continuation Retry/);
  });

  it("section names both adapters (session-recovery and Octto auto-resume)", () => {
    expect(AGENTS_MD).toContain("session-recovery");
    expect(AGENTS_MD).toContain("auto-resume");
  });

  it("section explicitly excludes lifecycle and ordinary chat", () => {
    expect(AGENTS_MD.toLowerCase()).toMatch(/排除|exclude/);
    expect(AGENTS_MD).toMatch(/lifecycle/);
  });

  it("section documents the two-layer boundary (spawn_agent 45s vs continuation 20x30s)", () => {
    expect(AGENTS_MD).toMatch(/45/);
    expect(AGENTS_MD).toMatch(/20/);
    expect(AGENTS_MD).toMatch(/30/);
  });

  it("section reaffirms resume_subagent is NOT broadened", () => {
    expect(AGENTS_MD).toMatch(/resume_subagent/);
  });
});
