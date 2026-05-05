import type { ColdInitDiscovery, PlannedNode, VaultPlan } from "@/atlas/cold-init/types";
import { ATLAS_LAYERS } from "@/atlas/types";

const MAX_SLUG_LENGTH = 64;
const SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const THOUGHTS_PATH_PREFIX = "thoughts/";
const THOUGHTS_SOURCE_PREFIX = "thoughts:";
const CLOSED_LIFECYCLE_STATES = new Set(["closed", "merging"]);
const INFERRED_BEHAVIOR_SUMMARY = "从已关闭生命周期记录推断的用户可见行为。";

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH) || "untitled";

const planIndex = (discovery: ColdInitDiscovery): PlannedNode => ({
  id: "index",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "00-index.md",
  title: discovery.projectName,
  summary: discovery.readmeSummary ?? `项目 ${discovery.projectName} 的 Atlas 知识库。`,
  sources: discovery.readmeSummary !== null ? ["code:README.md"] : [],
  connections: [],
  inferred: false,
});

const planBuildNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] =>
  discovery.modules.map((module) => ({
    id: `10-impl/${module.name}`,
    layer: ATLAS_LAYERS.IMPL,
    relativePath: `10-impl/${module.name}.md`,
    title: module.name,
    summary: module.responsibility,
    sources: [module.pointer],
    connections: [],
    inferred: false,
  }));

const findRelatedBuildIds = (text: string, modules: readonly { readonly name: string }[]): readonly string[] => {
  const lower = text.toLowerCase();
  return modules
    .filter((module) => lower.includes(module.name.toLowerCase()))
    .map((module) => `10-impl/${module.name}`);
};

const findClosedRecords = (discovery: ColdInitDiscovery): ColdInitDiscovery["lifecycleRecords"] =>
  discovery.lifecycleRecords.filter((record) => CLOSED_LIFECYCLE_STATES.has(record.state));

const normalizeDesignSource = (pointer: string): string => {
  if (SCHEME_PREFIX_PATTERN.test(pointer)) {
    return pointer;
  }
  if (pointer.startsWith(THOUGHTS_PATH_PREFIX)) {
    return `${THOUGHTS_SOURCE_PREFIX}${pointer.slice(THOUGHTS_PATH_PREFIX.length)}`;
  }
  return `${THOUGHTS_SOURCE_PREFIX}${pointer}`;
};

const planLifecycleBehaviorNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] =>
  findClosedRecords(discovery).map((record) => {
    const design = discovery.designs.find((artifact) => record.designPointers.includes(artifact.pointer));
    const title = design?.title ?? `Lifecycle ${record.issueNumber}`;
    return {
      id: `20-behavior/lifecycle-${record.issueNumber}`,
      layer: ATLAS_LAYERS.BEHAVIOR,
      relativePath: `20-behavior/lifecycle-${record.issueNumber}.md`,
      title,
      summary: design?.excerpt ?? INFERRED_BEHAVIOR_SUMMARY,
      sources: [record.pointer, ...record.designPointers.map(normalizeDesignSource)],
      connections: findRelatedBuildIds(`${title} ${design?.excerpt ?? ""}`, discovery.modules),
      inferred: design === undefined,
    };
  });

const planDesignBehaviorNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] =>
  discovery.designs.map((design) => ({
    id: `20-behavior/${slugify(design.title)}`,
    layer: ATLAS_LAYERS.BEHAVIOR,
    relativePath: `20-behavior/${slugify(design.title)}.md`,
    title: design.title,
    summary: design.excerpt,
    sources: [design.pointer],
    connections: findRelatedBuildIds(`${design.title} ${design.excerpt}`, discovery.modules),
    inferred: true,
  }));

const planBehaviorNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] => {
  const lifecycleNodes = planLifecycleBehaviorNodes(discovery);
  if (lifecycleNodes.length > 0) {
    return lifecycleNodes;
  }
  return planDesignBehaviorNodes(discovery);
};

const PHASE_ROADMAP_NODE: PlannedNode = {
  id: "decision/atlas-phase-roadmap",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "40-decisions/atlas-phase-roadmap.md",
  title: "Atlas phase roadmap",
  summary: "记录当前阶段的范围、推进顺序和交付边界。",
  sources: ["thoughts:shared/designs/2026-05-04-project-atlas-design.md"],
  connections: [],
  inferred: false,
};

const planDecisionNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] => {
  const memory = discovery.projectMemoryDecisions.map(
    (entry): PlannedNode => ({
      id: `40-decisions/${slugify(entry.id)}`,
      layer: ATLAS_LAYERS.DECISION,
      relativePath: `40-decisions/${slugify(entry.id)}.md`,
      title: entry.title,
      summary: entry.body,
      sources: [entry.pointer],
      connections: [],
      inferred: false,
    }),
  );
  return [PHASE_ROADMAP_NODE, ...memory];
};

const planRiskNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] =>
  discovery.projectMemoryRisks.map((entry) => ({
    id: `50-risks/${slugify(entry.id)}`,
    layer: ATLAS_LAYERS.RISK,
    relativePath: `50-risks/${slugify(entry.id)}.md`,
    title: entry.title,
    summary: entry.body,
    sources: [entry.pointer],
    connections: [],
    inferred: false,
  }));

const planTimelineNodes = (discovery: ColdInitDiscovery): readonly PlannedNode[] => {
  const records = findClosedRecords(discovery).map<PlannedNode>((record) => ({
    id: `60-timeline/lifecycle-${record.issueNumber}`,
    layer: ATLAS_LAYERS.TIMELINE,
    relativePath: `60-timeline/lifecycle-${record.issueNumber}.md`,
    title: `Lifecycle ${record.issueNumber}`,
    summary: `最近一次写入状态：${record.state}。`,
    sources: [record.pointer],
    connections: [`20-behavior/lifecycle-${record.issueNumber}`],
    inferred: false,
  }));
  const indexNode: PlannedNode = {
    id: "60-timeline/index",
    layer: ATLAS_LAYERS.TIMELINE,
    relativePath: "60-timeline/index.md",
    title: "Project timeline",
    summary: `项目时间线包含 ${records.length} 条生命周期记录。`,
    sources: [],
    connections: records.map((record) => record.id),
    inferred: false,
  };
  return [indexNode, ...records];
};

export function synthesizeVaultPlan(discovery: ColdInitDiscovery): VaultPlan {
  return {
    indexNode: planIndex(discovery),
    buildNodes: planBuildNodes(discovery),
    behaviorNodes: planBehaviorNodes(discovery),
    decisionNodes: planDecisionNodes(discovery),
    riskNodes: planRiskNodes(discovery),
    timelineNodes: planTimelineNodes(discovery),
  };
}
