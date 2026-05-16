import { describe, expect, it } from "bun:test";

import { DECISION_MINIMAL_RESPONSE_PROTOCOL } from "@/agents/decision-minimal-response";

describe("decision-minimal response protocol", () => {
  it("keeps user-facing output focused on decisions, acceptance, and next steps", () => {
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("decision-minimal");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("decision");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("acceptance");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("next-step");
  });

  it("forbids raw internal diagnostics in user-facing reports", () => {
    for (const phrase of ["raw recovery hint", "subagent raw reports", "reviewer checklist", "git logs"]) {
      expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain(phrase);
    }
  });

  it("requires internal artifact storage instead of chat dumping", () => {
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toMatch(/artifact|lifecycle progress|ledger|plan/i);
  });
});
