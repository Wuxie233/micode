import { describe, expect, it } from "bun:test";

import { buildQuestionBatch } from "@/atlas/cold-init/questions";
import type { ColdInitDiscovery, PlannedNode, VaultPlan } from "@/atlas/cold-init/types";
import { ATLAS_LAYERS } from "@/atlas/types";

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

const indexNode: PlannedNode = {
  id: "index",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "00-index.md",
  title: "demo",
  summary: "Project atlas for demo.",
  sources: [],
  connections: [],
  inferred: false,
};

const emptyPlan: VaultPlan = {
  indexNode,
  buildNodes: [],
  behaviorNodes: [],
  decisionNodes: [],
  riskNodes: [],
  timelineNodes: [],
};

const createBehaviorNode = (index: number): PlannedNode => ({
  id: `20-behavior/feature-${index}`,
  layer: ATLAS_LAYERS.BEHAVIOR,
  relativePath: `20-behavior/feature-${index}.md`,
  title: `Feature ${index}`,
  summary: `Feature ${index} summary`,
  sources: [`thoughts:shared/designs/feature-${index}.md`],
  connections: [],
  inferred: true,
});

describe("buildQuestionBatch", () => {
  it("always emits the three skippable intent questions", () => {
    const batch = buildQuestionBatch(emptyDiscovery, emptyPlan);
    const intent = batch.questions.filter((question) => question.group === "intent");
    expect(intent.length).toBe(3);
    expect(intent.every((question) => question.skippable)).toBe(true);
  });

  it("emits a behavior question per inferred behavior node without a five question cap", () => {
    const plan: VaultPlan = {
      ...emptyPlan,
      behaviorNodes: Array.from({ length: 6 }, (_, index) => createBehaviorNode(index + 1)),
    };
    const batch = buildQuestionBatch(emptyDiscovery, plan);
    const behavior = batch.questions.filter((question) => question.group === "behavior");
    expect(behavior.length).toBe(6);
    expect(batch.questions.length).toBe(9);
    expect(batch.truncated).toBe(false);
  });

  it("emits a risk question per open project-memory question", () => {
    const discovery: ColdInitDiscovery = {
      ...emptyDiscovery,
      projectMemoryOpenQuestions: [{ pointer: "pm:q1", id: "q1", title: "drift?", body: "?", status: "open" }],
    };
    const batch = buildQuestionBatch(discovery, emptyPlan);
    const risk = batch.questions.filter((question) => question.group === "risk");
    expect(risk).toHaveLength(1);
    expect(risk[0].skippable).toBe(true);
  });

  it("uses the configurable bound per generated question group", () => {
    const plan: VaultPlan = {
      ...emptyPlan,
      behaviorNodes: Array.from({ length: 15 }, (_, index) => createBehaviorNode(index + 1)),
    };
    const batch = buildQuestionBatch(emptyDiscovery, plan);
    const behavior = batch.questions.filter((question) => question.group === "behavior");
    expect(behavior).toHaveLength(12);
    expect(batch.questions.length).toBe(15);
    expect(batch.truncated).toBe(true);
  });
});
