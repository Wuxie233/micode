import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { primaryAgent } from "../../src/agents/commander";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");

describe("commander quick-op lane (issue #23)", () => {
  it("declares a quick-op lane block in the prompt", () => {
    expect(primaryAgent.prompt).toContain("<quick-op-lane");
    expect(primaryAgent.prompt).toContain("</quick-op-lane>");
  });

  it("documents in-scope and out-of-scope sections inside the quick-op lane", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<in-scope");
    expect(body).toContain("<out-of-scope");
  });

  it("declares anti-expansion rules for the quick-op lane", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<anti-expansion>");
  });

  it("lists hard escalation triggers that route to investigator and executor", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<hard-escalation-triggers");
    expect(body.toLowerCase()).toContain("investigator");
    expect(body.toLowerCase()).toContain("executor");
  });

  it("preserves the existing routing-by-requested-output contract", () => {
    expect(COMMANDER_SOURCE).toContain("routing-by-requested-output");
    const lower = COMMANDER_SOURCE.toLowerCase();
    expect(lower).toContain("location");
    expect(lower).toContain("explanation");
    expect(lower).toContain("diagnosis");
    expect(lower).toContain("mutation");
  });

  it("preserves the investigator/executor side-effect boundary", () => {
    expect(COMMANDER_SOURCE).toContain('<output-class name="diagnosis" agent="investigator">');
    expect(COMMANDER_SOURCE).toContain('<output-class name="mutation" agent="executor">');
  });

  it("does NOT introduce a runner or operator agent or lane", () => {
    const block = COMMANDER_SOURCE.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/)?.[0] ?? "";
    expect(block).toContain("<not-a-runner>");
    expect(COMMANDER_SOURCE).not.toMatch(/agent="runner"/);
    expect(COMMANDER_SOURCE).not.toMatch(/agent="operator"/);
    expect(COMMANDER_SOURCE).not.toMatch(/agent="light-executor"/);
  });

  it("uses requested-output classification, not keyword trigger lists", () => {
    const block = COMMANDER_SOURCE.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/)?.[0] ?? "";
    expect(block).not.toMatch(/trigger\s+keywords?\s*:/i);
    expect(block).not.toMatch(/keyword\s+list/i);
  });
});
