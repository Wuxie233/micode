import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import type { SourceKind } from "@/project-memory";
import {
  type ForgetOutcome,
  type ForgetTarget,
  forget,
  type ProjectMemoryStore,
  SourceKindValues,
} from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import type { ProjectIdentity } from "@/utils/project-id";
import { getIdentity, getStore } from "./runtime";

const TARGETS = {
  project: "project",
  entity: "entity",
  entry: "entry",
  source: "source",
} as const;
const TARGET_VALUES = [TARGETS.project, TARGETS.entity, TARGETS.entry, TARGETS.source] as const;
const PROJECT_PREFIX_LENGTH = 8;
const DESCRIPTION = `Hard-delete durable project memory entries scoped to the current project.

Args:
- target: project, entity, entry, or source
- entity_id: required when target=entity
- entry_id: required when target=entry
- source_kind and pointer: required when target=source`;

type TargetKind = (typeof TARGET_VALUES)[number];

interface ForgetArgs {
  readonly target: TargetKind;
  readonly entity_id?: string;
  readonly entry_id?: string;
  readonly source_kind?: SourceKind;
  readonly pointer?: string;
}

interface ProjectCounts {
  readonly entries: number;
  readonly entities: number;
}

function requireValue(value: string | undefined, field: string, target: TargetKind): string {
  if (value?.trim()) return value;
  throw new Error(`${field} is required when target is ${target}`);
}

function buildTarget(args: ForgetArgs): ForgetTarget {
  switch (args.target) {
    case TARGETS.project:
      return { kind: TARGETS.project };
    case TARGETS.entity:
      return { kind: TARGETS.entity, entityId: requireValue(args.entity_id, "entity_id", args.target) };
    case TARGETS.entry:
      return { kind: TARGETS.entry, entryId: requireValue(args.entry_id, "entry_id", args.target) };
    case TARGETS.source:
      return {
        kind: TARGETS.source,
        sourceKind: requireValue(args.source_kind, "source_kind", args.target),
        pointer: requireValue(args.pointer, "pointer", args.target),
      };
  }
}

async function countProject(
  store: ProjectMemoryStore,
  identity: ProjectIdentity,
  target: ForgetTarget,
): Promise<ProjectCounts | null> {
  if (target.kind !== TARGETS.project) return null;

  const [entries, entities] = await Promise.all([
    store.countEntries(identity.projectId),
    store.countEntities(identity.projectId),
  ]);
  return { entries, entities };
}

function prefix(projectId: string): string {
  return projectId.slice(0, PROJECT_PREFIX_LENGTH);
}

function formatProject(projectId: string, counts: ProjectCounts): string {
  return `Removed ${counts.entries} entries / ${counts.entities} entities for project ${prefix(projectId)}`;
}

function formatOutcome(projectId: string, outcome: ForgetOutcome, counts: ProjectCounts | null): string {
  switch (outcome.target.kind) {
    case TARGETS.project:
      return formatProject(projectId, counts ?? { entries: outcome.removed, entities: 0 });
    case TARGETS.entity:
      return `Removed ${outcome.removed} entity ${outcome.target.entityId} for project ${prefix(projectId)}`;
    case TARGETS.entry:
      return `Removed ${outcome.removed} entry ${outcome.target.entryId} for project ${prefix(projectId)}`;
    case TARGETS.source:
      return `Removed ${outcome.removed} source ${outcome.target.sourceKind} ${outcome.target.pointer} for project ${prefix(projectId)}`;
  }
}

export function createProjectMemoryForgetTool(ctx: PluginInput): { project_memory_forget: ToolDefinition } {
  const project_memory_forget = tool({
    description: DESCRIPTION,
    args: {
      target: tool.schema.enum(TARGET_VALUES).describe("Forget target: project, entity, entry, or source"),
      entity_id: tool.schema.string().optional().describe("Entity id, required when target=entity"),
      entry_id: tool.schema.string().optional().describe("Entry id, required when target=entry"),
      source_kind: tool.schema.enum(SourceKindValues).optional().describe("Source kind, required when target=source"),
      pointer: tool.schema.string().optional().describe("Source pointer, required when target=source"),
    },
    execute: async (args: ForgetArgs) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const target = buildTarget(args);
        const counts = await countProject(store, identity, target);
        const outcome = await forget({ store, identity, target });
        return formatOutcome(identity.projectId, outcome, counts);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_forget };
}
