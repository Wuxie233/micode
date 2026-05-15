import { describe, expect, it } from "bun:test";

import { implementerAgent } from "@/agents/implementer";

const PROMPT = implementerAgent.prompt ?? "";

describe("implementer compact escalation", () => {
  it("keeps leaf escalation compact and internal", () => {
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("compact facts");
    expect(PROMPT).toContain("raw recovery hint");
  });

  it("does not tell implementer to ask the user directly", () => {
    expect(PROMPT).not.toMatch(/ask the user directly/i);
  });
});
