import { existsSync, readFileSync } from "node:fs";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { ArtifactKind, LifecycleRecord } from "@/lifecycle";
import { ARTIFACT_KINDS } from "@/lifecycle";
import { validateUserPerspective } from "@/lifecycle/user-perspective-guard";
import { extractErrorMessage } from "@/utils/errors";

export interface RecordArtifactHandle {
  readonly recordArtifact: (issueNumber: number, kind: ArtifactKind, pointer: string) => Promise<LifecycleRecord>;
}

export interface RejectResult {
  readonly ok: boolean;
  readonly reason?: string;
}

const ARTIFACT_KIND_VALUES = Object.values(ARTIFACT_KINDS) as [ArtifactKind, ...ArtifactKind[]];
const GUARDED_ARTIFACT_KINDS = [ARTIFACT_KINDS.DESIGN, ARTIFACT_KINDS.LEDGER] as const;
const TOOL_DESCRIPTION = `Record a lifecycle artifact pointer on a tracked issue.
Use this after creating a design, plan, ledger, commit, PR, or worktree pointer.`;
const SUCCESS_HEADER = "## Lifecycle artifact recorded";
const FAILURE_HEADER = "## Lifecycle artifact recording failed";
const TABLE_HEADER = "| Issue # | Kind | Pointer | State |";
const TABLE_DIVIDER = "| --- | --- | --- | --- |";
const ISSUE_NUMBER_DESCRIPTION = "Lifecycle GitHub issue number";
const KIND_DESCRIPTION = "Artifact kind to record";
const POINTER_DESCRIPTION = "Artifact pointer, such as a file path, URL, commit SHA, or PR URL";
const UNKNOWN_USER_PERSPECTIVE_REASON = "User Perspective validation failed";
const ACCEPTED_ARTIFACT = { ok: true } as const;

const isGuardedArtifactKind = (kind: string): boolean => {
  return (GUARDED_ARTIFACT_KINDS as readonly string[]).includes(kind);
};

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

export function rejectIfMissingUserPerspective(kind: string, pointer: string): RejectResult {
  if (!isGuardedArtifactKind(kind)) return ACCEPTED_ARTIFACT;
  if (!existsSync(pointer)) return ACCEPTED_ARTIFACT;
  return validateUserPerspective(readFileSync(pointer, "utf8"));
}

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
        const guard = rejectIfMissingUserPerspective(args.kind, args.pointer);
        if (!guard.ok) return formatFailure(guard.reason ?? UNKNOWN_USER_PERSPECTIVE_REASON);
        const record = await handle.recordArtifact(args.issue_number, args.kind, args.pointer);
        return formatSuccess(record, args.kind, args.pointer);
      } catch (error) {
        return formatFailure(error);
      }
    },
  });
}
