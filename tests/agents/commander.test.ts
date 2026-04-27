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
    expect(primaryAgent.prompt).toContain(
      "For non-trivial requests, start lifecycle tracking with lifecycle_start_request and use /issue to inspect or transition the active lifecycle.",
    );
  });
});
