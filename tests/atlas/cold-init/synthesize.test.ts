import { describe, expect, it } from "bun:test";

import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import type { ColdInitDiscovery } from "@/atlas/cold-init/types";

const emptyDiscovery: ColdInitDiscovery = {
  projectName: "demo",
  projectRoot: "/tmp/demo",
  modules: [],
  designs: [],
  plans: [],
  ledgers: [],
  lifecycleRecords: [],
  mindmodelEntries: [],
  projectMemoryDecisions: [],
  projectMemoryRisks: [],
  projectMemoryOpenQuestions: [],
  readmeSummary: null,
  architectureSummary: null,
};

describe("synthesizeVaultPlan", () => {
  it("always plans an index node", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.indexNode.relativePath).toBe("00-index.md");
  });

  it("plans one build node per module", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      modules: [
        { name: "alpha", pointer: "code:src/alpha", responsibility: "x", relativePath: "src/alpha" },
        { name: "beta", pointer: "code:src/beta", responsibility: "y", relativePath: "src/beta" },
      ],
    });
    expect(plan.buildNodes).toHaveLength(2);
    expect(plan.buildNodes.map((node) => node.id).sort()).toEqual(["10-impl/alpha", "10-impl/beta"]);
  });

  it("falls back to design-derived behavior nodes when no closed lifecycle exists", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      designs: [
        {
          pointer: "thoughts:shared/designs/x.md",
          relativePath: "thoughts/shared/designs/x.md",
          title: "X feature",
          excerpt: "",
        },
      ],
    });
    expect(plan.behaviorNodes).toHaveLength(1);
    expect(plan.behaviorNodes[0].inferred).toBe(true);
  });

  it("emits closed-lifecycle behavior nodes with cross-layer connections", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      modules: [{ name: "alpha", pointer: "code:src/alpha", responsibility: "x", relativePath: "src/alpha" }],
      designs: [
        {
          pointer: "thoughts:shared/designs/alpha.md",
          relativePath: "thoughts/shared/designs/alpha.md",
          title: "alpha rework",
          excerpt: "rework alpha",
        },
      ],
      lifecycleRecords: [
        {
          pointer: "lifecycle:1",
          issueNumber: 1,
          state: "closed",
          designPointers: ["thoughts:shared/designs/alpha.md"],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
    });
    expect(plan.behaviorNodes).toHaveLength(1);
    expect(plan.behaviorNodes[0].sources).toContain("lifecycle:1");
    expect(plan.behaviorNodes[0].sources).toContain("thoughts:shared/designs/alpha.md");
    expect(plan.behaviorNodes[0].sources).not.toContain("thoughts:thoughts:shared/designs/alpha.md");
    expect(plan.behaviorNodes[0].connections).toContain("10-impl/alpha");
    expect(plan.behaviorNodes[0].inferred).toBe(false);
  });

  it("always plans the phase roadmap decision node", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.decisionNodes.some((node) => node.id === "decision/atlas-phase-roadmap")).toBe(true);
  });
});
