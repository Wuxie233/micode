import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { LifecycleHandle } from "@/lifecycle";
import type { RecoveryDecision } from "@/lifecycle/recovery/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Inspect lifecycle state and produce a recovery decision.

Use after an OpenCode restart, before resuming executor work. Read-only: this tool does not mutate
state. The decision is one of clean_resume, reconciled_resume, partial_resume, or blocked.`;

const SUCCESS_HEADER = "## Lifecycle recovery decision";
const FAILURE_HEADER = "## lifecycle_recovery_decision failed";
const LINE_BREAK = "\n";

const formatDecision = (decision: RecoveryDecision): string => {
  const lines = [`**kind:** \`${decision.kind}\``, `**lastSeq:** ${decision.lastSeq}`];
  if (decision.kind === "blocked") {
    lines.push(`**reason:** \`${decision.reason}\``);
    lines.push(`**detail:** ${decision.detail}`);
  }
  if (decision.kind === "reconciled_resume") {
    lines.push(`**backfilledBatches:** ${decision.backfilledBatches.join(", ") || "(none)"}`);
    lines.push(`**nextBatchId:** ${decision.nextBatchId ?? "(none)"}`);
  }
  if (decision.kind === "partial_resume") {
    lines.push(`**completedBatches:** ${decision.completedBatches.join(", ") || "(none)"}`);
    lines.push(`**pendingBatchId:** ${decision.pendingBatchId}`);
    lines.push(`**note:** ${decision.note}`);
  }
  if (decision.kind === "clean_resume") {
    lines.push(`**nextBatchId:** ${decision.nextBatchId ?? "(none)"}`);
  }
  return [SUCCESS_HEADER, "", ...lines].join(LINE_BREAK);
};

export type RecoveryHandle = Pick<LifecycleHandle, "decideRecovery">;

export function createLifecycleRecoveryDecisionTool(handle: RecoveryHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number for the lifecycle record"),
      owner: tool.schema.string().describe("Caller identifier (typically the OpenCode session id)"),
    },
    execute: async (args) => {
      try {
        const decision = await handle.decideRecovery(args.issue_number, args.owner);
        return formatDecision(decision);
      } catch (error) {
        return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
