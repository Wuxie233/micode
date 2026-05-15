import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { primaryAgent as commanderAgent } from "@/agents/commander";
import { LENS_SWARM_PROTOCOL } from "@/agents/lens-swarm-protocol";

const SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const PROMPT = commanderAgent.prompt ?? "";

describe("commander Lens Swarm prompt contract", () => {
  it("imports and injects the shared Lens Swarm protocol", () => {
    expect(SOURCE).toContain("LENS_SWARM_PROTOCOL");
    expect(PROMPT).toContain(LENS_SWARM_PROTOCOL);
  });

  it("lists brainstorm-scout in the header and available-agents block", () => {
    const header = SOURCE.match(/Available micode agents:[^\n]+/)?.[0] ?? "";

    expect(header).toContain("brainstorm-scout");
    expect(SOURCE).toContain('<agent name="brainstorm-scout" mode="subagent"');
  });

  it("routes generalized adversarial requests to Adversarial Swarm", () => {
    expect(PROMPT).toContain("Adversarial Swarm");
    expect(PROMPT).toContain("泛化对抗审查");
    expect(PROMPT).toContain("brainstorm-scout");
  });

  it("preserves explicit critic-role compatibility", () => {
    expect(PROMPT).toContain("explicit critic-role compatibility");
    expect(PROMPT).toContain("critic");
    expect(PROMPT).toContain("redteam");
    expect(PROMPT).toContain("cross-family");
  });

  it("does not route brainstorm-scout through output-class", () => {
    expect(SOURCE).not.toMatch(/<output-class[^>]*agent="brainstorm-scout"/);
  });
});
