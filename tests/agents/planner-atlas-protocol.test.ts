import { describe, expect, it } from "bun:test";

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { plannerAgent } from "@/agents/planner";

describe("planner prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(plannerAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("places the protocol block after project-memory and before process", () => {
    const p = plannerAgent.prompt ?? "";
    const memIdx = p.indexOf("</project-memory>");
    const protocolIdx = p.indexOf("<atlas-mental-model");
    const processIdx = p.indexOf("<process>");
    expect(memIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBeGreaterThan(memIdx);
    expect(processIdx).toBeGreaterThan(protocolIdx);
  });

  it("documents the optional Atlas-impact task field", () => {
    expect(plannerAgent.prompt).toContain("Atlas-impact");
    expect(plannerAgent.prompt).toContain("layer-update");
    expect(plannerAgent.prompt).toContain("new-node");
  });

  it("does not duplicate the protocol block", () => {
    const p = plannerAgent.prompt ?? "";
    const matches = p.match(/<atlas-mental-model/gu) ?? [];
    expect(matches.length).toBe(1);
  });
});
