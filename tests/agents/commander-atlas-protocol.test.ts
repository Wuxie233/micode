import { describe, expect, it } from "bun:test";

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { commanderAgent } from "@/agents/commander";

describe("commander prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(commanderAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("documents quick-op default of no-change", () => {
    const p = commanderAgent.prompt ?? "";
    expect(p).toContain("quick-op");
    expect(p).toContain("no-change");
  });

  it("places the protocol after effect-first reporting", () => {
    const p = commanderAgent.prompt ?? "";
    const effectFirstEnd = p.indexOf("</effect-first-reporting>");
    const atlasProtocol = p.indexOf(ATLAS_MENTAL_MODEL_PROTOCOL);

    expect(effectFirstEnd).toBeGreaterThanOrEqual(0);
    expect(atlasProtocol).toBeGreaterThan(effectFirstEnd);
  });

  it("documents delegated consultation relay", () => {
    const p = commanderAgent.prompt ?? "";

    expect(p).toContain("atlas consultation is owned by the delegated agent");
    expect(p).toContain("relays the eventual Atlas status");
  });
});
