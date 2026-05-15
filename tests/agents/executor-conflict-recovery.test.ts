import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

const PROMPT = executorAgent.prompt ?? "";

describe("executor conflict recovery prompt", () => {
  it("parses merge_conflict recovery hints into a bounded resolver flow", () => {
    expect(PROMPT).toContain("merge_conflict");
    expect(PROMPT).toContain("conflict resolver flow");
    expect(PROMPT).toContain("temp worktree");
    expect(PROMPT).toContain("conflict files");
  });

  it("enforces resolver scope and mandatory reviewer coverage", () => {
    expect(PROMPT).toContain("directly related tests/types/call sites");
    expect(PROMPT).toContain("semantic ambiguity");
    expect(PROMPT).toContain("reviewer mandatory");
    expect(PROMPT).not.toContain("skip reviewer for conflict resolver");
  });

  it("keeps unsafe recovery shortcuts forbidden", () => {
    expect(PROMPT).toContain("--force-with-lease");
    expect(PROMPT).toContain("reset --hard");
    expect(PROMPT).toContain("--no-verify");
  });
});
