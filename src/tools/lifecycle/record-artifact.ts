import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { ArtifactKind, LifecycleRecord } from "@/lifecycle";
import { ARTIFACT_KINDS } from "@/lifecycle";
import { extractErrorMessage } from "@/utils/errors";

export interface RecordArtifactHandle {
  readonly recordArtifact: (issueNumber: number, kind: ArtifactKind, pointer: string) => Promise<LifecycleRecord>;
}

const ARTIFACT_KIND_VALUES = Object.values(ARTIFACT_KINDS) as [ArtifactKind, ...ArtifactKind[]];
const TOOL_DESCRIPTION = `Record a lifecycle artifact pointer on a tracked issue.
Use this after creating a design, plan, ledger, commit, PR, or worktree pointer.`;
const SUCCESS_HEADER = "## Lifecycle artifact recorded";
const FAILURE_HEADER = "## Lifecycle artifact recording failed";
const TABLE_HEADER = "| Issue # | Kind | Pointer | State |";
const TABLE_DIVIDER = "| --- | --- | --- | --- |";
const ISSUE_NUMBER_DESCRIPTION = "Lifecycle GitHub issue number";
const KIND_DESCRIPTION = "Artifact kind to record";
const POINTER_DESCRIPTION = "Artifact pointer, such as a file path, URL, commit SHA, or PR URL";

const formatSuccess = (record: LifecycleRecord, kind: ArtifactKind, pointer: string): string => {
  return [
    SUCCESS_HEADER,
    "",
    TABLE_HEADER,
    TABLE_DIVIDER,
    `| ${record.issueNumber} | ${kind} | ${pointer} | ${record.state} |`,
  ].join("\n");
};

const formatFailure = (error: unknown): string => `${FAILURE_HEADER}\n\n${extractErrorMessage(error)}`;

export function createLifecycleRecordArtifactTool(handle: RecordArtifactHandle): ToolDefinition {
  return tool({
    description: TOOL_DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe(ISSUE_NUMBER_DESCRIPTION),
      kind: tool.schema.enum(ARTIFACT_KIND_VALUES).describe(KIND_DESCRIPTION),
      pointer: tool.schema.string().describe(POINTER_DESCRIPTION),
    },
    execute: async (args) => {
      try {
        const record = await handle.recordArtifact(args.issue_number, args.kind, args.pointer);
        return formatSuccess(record, args.kind, args.pointer);
      } catch (error) {
        return formatFailure(error);
      }
    },
  });
}
