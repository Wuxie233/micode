import { describe, expect, it } from "bun:test";

import { atlasInitializerAgent } from "@/agents/atlas-initializer";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe("atlas-initializer context capsule protocol", () => {
  it("injects the canonical context capsule protocol before the phase plan", () => {
    const prompt = atlasInitializerAgent.prompt;

    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);

    const protocolIndex = prompt.indexOf(CONTEXT_CAPSULE_PROTOCOL);
    const phasePlanIndex = prompt.indexOf("<phase-plan>");

    expect(protocolIndex).toBeGreaterThan(-1);
    expect(phasePlanIndex).toBeGreaterThan(-1);
    expect(protocolIndex).toBeLessThan(phasePlanIndex);
  });

  it("keeps the capsule as hot-path context and not an atlas node", () => {
    const prompt = atlasInitializerAgent.prompt;

    expect(prompt).toContain("capsule is not an atlas node");
    expect(prompt).toContain("same contextCapsule object");
    expect(prompt).toContain("hot-path prompt prefix");
  });

  it("preserves normal atlas initializer write and reconcile flow", () => {
    const prompt = atlasInitializerAgent.prompt;

    expect(prompt).toContain('<phase name="4-reconcile"');
    expect(prompt).toContain('<phase name="5-write"');
    expect(prompt).toContain("Collect all worker output");
    expect(prompt).toContain("Write all atlas/ files");
    expect(prompt).toContain("Write 00-index.md last");
  });
});
