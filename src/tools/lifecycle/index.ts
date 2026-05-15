import type { ToolDefinition } from "@opencode-ai/plugin";

import type { LifecycleHandle } from "@/lifecycle";
import type { ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import type { LifecycleRunner } from "@/lifecycle/runner";
import { createLifecycleAuditBranchesTool } from "./audit-branches";
import { createLifecycleCommitTool } from "./commit";
import { createLifecycleContextTool } from "./context";
import { createLifecycleCurrentTool } from "./current";
import { createLifecycleFinishTool } from "./finish";
import { createLifecycleLogProgressTool } from "./log-progress";
import { createLifecycleRecordArtifactTool } from "./record-artifact";
import { createLifecycleRecoveryDecisionTool } from "./recovery-decision";
import { createLifecycleResumeTool } from "./resume";
import { createLifecycleStartRequestTool } from "./start-request";

export interface LifecycleTools {
  readonly lifecycle_audit_branches: ToolDefinition;
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
  readonly lifecycle_current: ToolDefinition;
  readonly lifecycle_resume: ToolDefinition;
  readonly lifecycle_log_progress: ToolDefinition;
  readonly lifecycle_context: ToolDefinition;
  readonly lifecycle_recovery_decision: ToolDefinition;
}

export function createLifecycleTools(
  handle: LifecycleHandle,
  resolver: Resolver,
  progress: ProgressLogger,
  runner?: LifecycleRunner,
  cwd?: string,
): LifecycleTools {
  const auditRunner = runner ?? {
    git: async () => ({ stdout: "", stderr: "missing runner", exitCode: 1 }),
    gh: async () => ({ stdout: "", stderr: "missing runner", exitCode: 1 }),
  };
  const auditCwd = cwd ?? process.cwd();
  return {
    lifecycle_audit_branches: createLifecycleAuditBranchesTool({ runner: auditRunner, resolver, cwd: auditCwd }),
    lifecycle_start_request: createLifecycleStartRequestTool(handle),
    lifecycle_record_artifact: createLifecycleRecordArtifactTool(handle),
    lifecycle_commit: createLifecycleCommitTool(handle),
    lifecycle_finish: createLifecycleFinishTool(handle),
    lifecycle_current: createLifecycleCurrentTool(resolver),
    lifecycle_resume: createLifecycleResumeTool(resolver),
    lifecycle_log_progress: createLifecycleLogProgressTool(progress),
    lifecycle_context: createLifecycleContextTool(progress),
    lifecycle_recovery_decision: createLifecycleRecoveryDecisionTool(handle),
  };
}
