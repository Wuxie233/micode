// tests/agents/investigator.test.ts
import { describe, expect, it } from "bun:test";

import { investigatorAgent } from "../../src/agents/investigator";

describe("investigator agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(investigatorAgent.mode).toBe("subagent");
    expect(investigatorAgent.tools?.write).toBe(false);
    expect(investigatorAgent.tools?.edit).toBe(false);
    expect(investigatorAgent.tools?.bash).toBe(false);
    expect(investigatorAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-gathering work", () => {
    expect(investigatorAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a diagnostic read-only investigator", () => {
    const description = investigatorAgent.description ?? "";
    expect(description.toLowerCase()).toContain("diagnostic");
    expect(description.toLowerCase()).toContain("read-only");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and implementation work", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt).toContain("never");
    // Forbidden actions per design Error Handling section
    expect(prompt.toLowerCase()).toContain("commit");
    expect(prompt.toLowerCase()).toContain("deploy");
    expect(prompt.toLowerCase()).toContain("restart");
    expect(prompt.toLowerCase()).toContain("mutation");
  });

  it("prompt requires the diagnosis output contract: facts, evidence, likely cause, uncertainty, escalation", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt.toLowerCase()).toContain("facts");
    expect(prompt.toLowerCase()).toContain("evidence");
    expect(prompt.toLowerCase()).toContain("likely cause");
    expect(prompt.toLowerCase()).toContain("uncertainty");
    expect(prompt.toLowerCase()).toContain("escalation");
  });

  it("prompt enumerates the three escalation outcomes", () => {
    const prompt = investigatorAgent.prompt ?? "";
    // Per design Components > Escalation protocol
    expect(prompt.toLowerCase()).toContain("no escalation");
    expect(prompt.toLowerCase()).toContain("executor");
    expect(prompt.toLowerCase()).toContain("user confirmation");
  });

  it("prompt forbids the executor / planner / locator / analyzer overlap", () => {
    const prompt = investigatorAgent.prompt ?? "";
    // Per design constraints: must not become a lightweight executor / generic read-only fallback
    expect(prompt.toLowerCase()).toContain("not a");
    expect(prompt.toLowerCase()).toContain("locator");
    expect(prompt.toLowerCase()).toContain("analyzer");
  });

  it("prompt declares the micode environment, matching other subagents", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });
});
