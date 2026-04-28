import type { ToolDefinition } from "@opencode-ai/plugin";

import type { LifecycleHandle } from "@/lifecycle";
import type { ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleCommitTool } from "./commit";
import { createLifecycleContextTool } from "./context";
import { createLifecycleCurrentTool } from "./current";
import { createLifecycleFinishTool } from "./finish";
import { createLifecycleLogProgressTool } from "./log-progress";
import { createLifecycleRecordArtifactTool } from "./record-artifact";
import { createLifecycleResumeTool } from "./resume";
import { createLifecycleStartRequestTool } from "./start-request";

export interface LifecycleTools {
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
  readonly lifecycle_current: ToolDefinition;
  readonly lifecycle_resume: ToolDefinition;
  readonly lifecycle_log_progress: ToolDefinition;
  readonly lifecycle_context: ToolDefinition;
}

export function createLifecycleTools(
  handle: LifecycleHandle,
  resolver: Resolver,
  progress: ProgressLogger,
): LifecycleTools {
  return {
    lifecycle_start_request: createLifecycleStartRequestTool(handle),
    lifecycle_record_artifact: createLifecycleRecordArtifactTool(handle),
    lifecycle_commit: createLifecycleCommitTool(handle),
    lifecycle_finish: createLifecycleFinishTool(handle),
    lifecycle_current: createLifecycleCurrentTool(resolver),
    lifecycle_resume: createLifecycleResumeTool(resolver),
    lifecycle_log_progress: createLifecycleLogProgressTool(progress),
    lifecycle_context: createLifecycleContextTool(progress),
  };
}
