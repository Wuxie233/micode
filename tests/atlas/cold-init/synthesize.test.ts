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
    expect(plan.indexNode.summary).toBe("项目 demo 的 Atlas 知识库。");
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

  it("uses a Chinese behavior fallback when a closed lifecycle has no design", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      lifecycleRecords: [
        {
          pointer: "lifecycle:2",
          issueNumber: 2,
          state: "closed",
          designPointers: [],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
    });
    expect(plan.behaviorNodes).toHaveLength(1);
    expect(plan.behaviorNodes[0].summary).toContain("行为");
    expect(plan.behaviorNodes[0].summary).not.toContain("Behavior derived from lifecycle");
    expect(plan.behaviorNodes[0].sources).toEqual(["lifecycle:2"]);
    expect(plan.behaviorNodes[0].relativePath).toBe("20-behavior/lifecycle-2.md");
  });

  it("always plans the phase roadmap decision node", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.decisionNodes.some((node) => node.id === "decision/atlas-phase-roadmap")).toBe(true);
    expect(plan.decisionNodes.find((node) => node.id === "decision/atlas-phase-roadmap")?.summary).toContain(
      "当前阶段",
    );
  });

  it("plans Chinese timeline summaries while preserving lifecycle pointers", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      lifecycleRecords: [
        {
          pointer: "lifecycle:3",
          issueNumber: 3,
          state: "merging",
          designPointers: [],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
    });
    expect(plan.timelineNodes[0].id).toBe("60-timeline/index");
    expect(plan.timelineNodes[0].summary).toContain("时间线");
    expect(plan.timelineNodes[0].summary).toContain("1");
    expect(plan.timelineNodes[0].connections).toEqual(["60-timeline/lifecycle-3"]);
    expect(plan.timelineNodes[1]).toMatchObject({
      id: "60-timeline/lifecycle-3",
      relativePath: "60-timeline/lifecycle-3.md",
      summary: "最近一次写入状态：merging。",
      sources: ["lifecycle:3"],
      connections: ["20-behavior/lifecycle-3"],
    });
  });
});
