import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnswerMap } from "@/atlas/cold-init/orchestrator";
import { renderColdInitNode } from "@/atlas/cold-init/renderer";
import type { PlannedNode, VaultPlan } from "@/atlas/cold-init/types";
import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { commitStagedPages, stagePageWrite } from "@/atlas/page-writer";
import { type AtlasPaths, createAtlasPaths } from "@/atlas/paths";
import { writeSchemaVersion } from "@/atlas/schema-version";
import { createStagingManager, type StagingManager } from "@/atlas/staging";

const EMPTY_COMMIT = "";
const MARKED_INFERRED = "（推断草稿）";

export interface WriteVaultInput {
  readonly projectRoot: string;
  readonly runId: string;
  readonly plan: VaultPlan;
  readonly answers: AnswerMap;
}

export interface WriteVaultResult {
  readonly nodesWritten: number;
  readonly stagingDir: string;
  readonly logPath: string;
}

const noteFor = (node: PlannedNode, answers: AnswerMap): string | null => {
  const note = answers[node.id] ?? answers[`behavior.${node.id}`] ?? answers[`risk.${node.id}`];
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
};

const ensureDir = (dir: string): void => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
};

const ensureAtlasDirs = (paths: AtlasPaths): void => {
  const dirs = [
    paths.root,
    paths.impl,
    paths.behavior,
    paths.decisions,
    paths.risks,
    paths.timeline,
    paths.archive,
    paths.meta,
    paths.challenges,
    paths.log,
    paths.staging,
  ];
  for (const dir of dirs) ensureDir(dir);
};

const collectNodes = (plan: VaultPlan): readonly PlannedNode[] => [
  plan.indexNode,
  ...plan.buildNodes,
  ...plan.behaviorNodes,
  ...plan.decisionNodes,
  ...plan.riskNodes,
  ...plan.timelineNodes,
];

const stageNode = (
  staging: StagingManager,
  paths: AtlasPaths,
  node: PlannedNode,
  answers: AnswerMap,
  nowMs: number,
): void => {
  const target = join(paths.root, node.relativePath);
  ensureDir(dirname(target));
  const body = renderColdInitNode({
    node,
    userNote: noteFor(node, answers),
    lastVerifiedCommit: EMPTY_COMMIT,
    lastWrittenMtime: nowMs,
  });
  stagePageWrite(staging, target, body);
};

const renderMaintenanceLog = (runId: string, plan: VaultPlan, answersCount: number): string => {
  const nodes = collectNodes(plan);
  const lines = [
    `# 冷启动初始化运行 ${runId}`,
    "",
    `本次运行写入 ${nodes.length} 个节点，覆盖构建、行为、决策、风险和时间线层。`,
    `本次运行合并了 ${answersCount} 条来自 Octto 的用户补充。`,
    "",
    "## 已写入节点",
    ...nodes.map((node) => `- ${node.relativePath}${node.inferred ? MARKED_INFERRED : ""}`),
  ];
  return `${lines.join("\n")}\n`;
};

const stageMaintenanceLog = (staging: StagingManager, paths: AtlasPaths, input: WriteVaultInput): string => {
  const logPath = join(paths.log, `${input.runId}.md`);
  const body = renderMaintenanceLog(input.runId, input.plan, Object.keys(input.answers).length);
  stagePageWrite(staging, logPath, body);
  return logPath;
};

export async function writeVault(input: WriteVaultInput): Promise<WriteVaultResult> {
  const paths = createAtlasPaths(input.projectRoot);
  ensureAtlasDirs(paths);

  const staging = createStagingManager(input.projectRoot, input.runId);
  staging.create();

  const nowMs = Date.now();
  const nodes = collectNodes(input.plan);
  try {
    for (const node of nodes) stageNode(staging, paths, node, input.answers, nowMs);
    const logPath = stageMaintenanceLog(staging, paths, input);
    await commitStagedPages(staging);
    writeSchemaVersion(paths.schemaVersionFile, ATLAS_SCHEMA_VERSION);
    return { nodesWritten: nodes.length, stagingDir: staging.dir, logPath };
  } catch (error) {
    staging.rollback();
    throw error;
  }
}
