import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { executorAgent } from "@/agents/executor";

describe("executor prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(executorAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("appends an executor-specific atlas-propagation block", () => {
    const p = executorAgent.prompt ?? "";
    expect(p).toContain("<atlas-propagation");
    // executor must not grant atlas_lookup to leaf agents
    expect(p).toContain("atlas_lookup");
    expect(p).toContain("leaf agents");
  });

  it("places protocol after contract-propagation", () => {
    const p = executorAgent.prompt ?? "";
    const cpIdx = p.indexOf("</contract-propagation>");
    const protocolIdx = p.indexOf("<atlas-mental-model");
    expect(cpIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBeGreaterThan(cpIdx);
  });
});
