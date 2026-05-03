import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { promoteApprovedCandidate } from "@/skill-evolution/promote-bridge";
import { listPending, purgeExpiredCandidates, rejectCandidate } from "@/skill-evolution/review";
import { type CandidateStore, createCandidateStore } from "@/skill-evolution/store";
import { getIdentity, getStore } from "@/tools/project-memory/runtime";
import { extractErrorMessage } from "@/utils/errors";
import type { ProjectIdentity } from "@/utils/project-id";

export interface SkillsToolOptions {
  readonly candidateStore?: CandidateStore;
  readonly identityOverride?: ProjectIdentity;
  readonly now?: () => number;
}

export interface SkillsTools {
  readonly skills_list: ToolDefinition;
  readonly skills_approve: ToolDefinition;
  readonly skills_reject: ToolDefinition;
}

interface PendingCandidate {
  readonly id: string;
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly createdAt: number;
}

interface SkillsToolState {
  readonly candidateStore: CandidateStore;
  readonly now: () => number;
  readonly resolveIdentity: () => Promise<ProjectIdentity>;
}

const ERROR_HEADER = "## Error";
const PENDING_HEADER = "## Pending skill candidates";
const EMPTY_PENDING = "(none)";
const LINE_BREAK = "\n";

function formatError(error: unknown): string {
  return `${ERROR_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
}

function formatFailure(reason: string): string {
  return `${ERROR_HEADER}${LINE_BREAK}${LINE_BREAK}${reason}`;
}

function formatSteps(steps: readonly string[]): string {
  return steps.map((step) => `  - ${step}`).join(LINE_BREAK);
}

function formatCandidate(candidate: PendingCandidate): string {
  return [
    `- **${candidate.id}** [${new Date(candidate.createdAt).toISOString()}] ${candidate.trigger}`,
    formatSteps(candidate.steps),
  ].join(LINE_BREAK);
}

function formatCandidates(candidates: readonly PendingCandidate[]): string {
  if (candidates.length === 0) return `${PENDING_HEADER}${LINE_BREAK}${LINE_BREAK}${EMPTY_PENDING}`;

  const lines = candidates.map(formatCandidate).join(LINE_BREAK);
  return [PENDING_HEADER, "", lines, "", "Approve with `skills_approve` or reject with `skills_reject`."].join(
    LINE_BREAK,
  );
}

function createListTool(state: SkillsToolState): ToolDefinition {
  return tool({
    description: "List pending skill candidates for the current project. Purges expired candidates first.",
    args: {},
    execute: async () => {
      try {
        const identity = await state.resolveIdentity();
        await purgeExpiredCandidates({
          store: state.candidateStore,
          projectId: identity.projectId,
          now: state.now(),
        });
        const pending = await listPending(state.candidateStore, identity.projectId);
        return formatCandidates(pending);
      } catch (error) {
        return formatError(error);
      }
    },
  });
}

function createApproveTool(state: SkillsToolState): ToolDefinition {
  return tool({
    description: "Approve a pending skill candidate by id and promote it as tentative project memory procedures.",
    args: { id: tool.schema.string().describe("Candidate id, e.g. cand_abc123") },
    execute: async ({ id }) => {
      try {
        const identity = await state.resolveIdentity();
        const memoryStore = await getStore();
        const result = await promoteApprovedCandidate({
          candidateStore: state.candidateStore,
          memoryStore,
          identity,
          candidateId: id,
        });
        if (!result.ok) return formatFailure(result.reason);
        return `## Approved${LINE_BREAK}${LINE_BREAK}Candidate ${result.candidateId} approved and promoted as ${result.entryIds.length} tentative procedure entry/entries.`;
      } catch (error) {
        return formatError(error);
      }
    },
  });
}

function createRejectTool(state: SkillsToolState): ToolDefinition {
  return tool({
    description: "Reject and delete a pending skill candidate by id.",
    args: {
      id: tool.schema.string().describe("Candidate id"),
      reason: tool.schema.string().describe("Why this candidate is being rejected"),
    },
    execute: async ({ id, reason }) => {
      try {
        const identity = await state.resolveIdentity();
        const result = await rejectCandidate({
          store: state.candidateStore,
          projectId: identity.projectId,
          candidateId: id,
          reason,
        });
        if (!result.ok) return formatFailure(result.reason);
        return `## Rejected${LINE_BREAK}${LINE_BREAK}Candidate ${id} rejected: ${reason}`;
      } catch (error) {
        return formatError(error);
      }
    },
  });
}

export function createSkillsTools(ctx: PluginInput, options: SkillsToolOptions = {}): SkillsTools {
  const state: SkillsToolState = {
    candidateStore: options.candidateStore ?? createCandidateStore(),
    now: options.now ?? Date.now,
    resolveIdentity: async () => options.identityOverride ?? (await getIdentity(ctx.directory)),
  };

  return {
    skills_list: createListTool(state),
    skills_approve: createApproveTool(state),
    skills_reject: createRejectTool(state),
  };
}
