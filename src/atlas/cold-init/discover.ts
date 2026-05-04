import { collectArtifactExcerpts } from "@/atlas/cold-init/sources/artifact-excerpts";
import { collectLifecycleHistory } from "@/atlas/cold-init/sources/lifecycle-history";
import { collectProjectSurvey } from "@/atlas/cold-init/sources/project-survey";
import type {
  ColdInitDiscovery,
  DiscoveredArtifact,
  DiscoveredMemoryEntry,
  DiscoveredModule,
} from "@/atlas/cold-init/types";
import { collectMindmodelSources } from "@/atlas/sources/mindmodel";
import { collectModuleEntries } from "@/atlas/sources/module-map";
import { collectProjectMemorySources, type ProjectMemoryEntry } from "@/atlas/sources/project-memory";

export interface ProjectMemoryReader {
  readonly list: () => Promise<readonly ProjectMemoryEntry[]>;
}

export interface DiscoverInput {
  readonly projectRoot: string;
  readonly projectMemory: ProjectMemoryReader;
}

const toDiscoveredModule = (module: {
  readonly name: string;
  readonly pointer: string;
  readonly responsibility: string;
  readonly relativePath: string;
}): DiscoveredModule => ({
  name: module.name,
  pointer: module.pointer,
  responsibility: module.responsibility,
  relativePath: module.relativePath,
});

const toDiscoveredArtifact = (artifact: {
  readonly pointer: string;
  readonly relativePath: string;
  readonly title?: string;
  readonly excerpt?: string;
}): DiscoveredArtifact => ({
  pointer: artifact.pointer,
  relativePath: artifact.relativePath,
  title: artifact.title ?? artifact.relativePath,
  excerpt: artifact.excerpt ?? "",
});

const toDiscoveredMemoryEntry = (projection: {
  readonly pointer: string;
  readonly entry: ProjectMemoryEntry;
}): DiscoveredMemoryEntry => ({
  pointer: projection.pointer,
  id: projection.entry.id,
  title: projection.entry.title,
  body: projection.entry.body,
  status: projection.entry.status,
});

export async function discoverProject(input: DiscoverInput): Promise<ColdInitDiscovery> {
  const [survey, modules, artifacts, lifecycle, mindmodel, memory] = await Promise.all([
    collectProjectSurvey(input.projectRoot),
    collectModuleEntries(input.projectRoot),
    collectArtifactExcerpts(input.projectRoot),
    collectLifecycleHistory(input.projectRoot),
    collectMindmodelSources(input.projectRoot),
    collectProjectMemorySources(input.projectMemory),
  ]);

  return {
    projectName: survey.projectName,
    projectRoot: input.projectRoot,
    modules: modules.map(toDiscoveredModule),
    designs: artifacts.filter((artifact) => artifact.kind === "design").map(toDiscoveredArtifact),
    plans: artifacts.filter((artifact) => artifact.kind === "plan").map(toDiscoveredArtifact),
    ledgers: artifacts.filter((artifact) => artifact.kind === "ledger").map(toDiscoveredArtifact),
    lifecycleRecords: lifecycle.map((entry) => ({
      pointer: entry.pointer,
      issueNumber: entry.issueNumber,
      state: entry.state,
      designPointers: entry.designPointers,
      planPointers: entry.planPointers,
      ledgerPointers: entry.ledgerPointers,
    })),
    mindmodelEntries: mindmodel.map((entry) =>
      toDiscoveredArtifact({ ...entry, title: entry.relativePath, excerpt: "" }),
    ),
    projectMemoryDecisions: memory.decisions.map(toDiscoveredMemoryEntry),
    projectMemoryRisks: memory.risks.map(toDiscoveredMemoryEntry),
    projectMemoryOpenQuestions: memory.openQuestions.map(toDiscoveredMemoryEntry),
    readmeSummary: survey.readmeSummary,
    architectureSummary: survey.architectureSummary,
  };
}
