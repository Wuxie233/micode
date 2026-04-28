import { describe, expect, it } from "bun:test";
import { primaryAgent } from "../../src/agents/commander";

describe("commander agent", () => {
  it("should not reference handoff agents in prompt", () => {
    expect(primaryAgent.prompt).not.toContain("handoff-creator");
    expect(primaryAgent.prompt).not.toContain("handoff-resumer");
    expect(primaryAgent.prompt).not.toContain('<phase name="handoff">');
  });

  it("should still reference ledger", () => {
    expect(primaryAgent.prompt).toContain("ledger");
    expect(primaryAgent.prompt).toContain('<resume-handling priority="critical">');
  });

  it("should document commander lifecycle routing rules", () => {
    expect(primaryAgent.prompt).toContain(
      "Quick-mode tasks (typo fixes, version bumps, single-line patches) do NOT enter the v9 lifecycle. No issue, no worktree, no lifecycle_* calls.",
    );
    expect(primaryAgent.prompt).toContain(
      "Complex tasks routed through the brainstormer: brainstormer owns every lifecycle_* call (start, record_artifact, finish). You do NOT call lifecycle_start_request yourself.",
    );
    expect(primaryAgent.prompt).toContain(
      "Your only lifecycle responsibility is to ensure the user's request reaches brainstormer when the request is non-trivial.",
    );
    expect(primaryAgent.prompt).toContain(
      "Use the /issue slash command when the user asks to inspect or manually transition an active lifecycle.",
    );
  });
});
