import type { ToolDefinition } from "@opencode-ai/plugin";

import type { LifecycleHandle } from "@/lifecycle";
import { createLifecycleCommitTool } from "./commit";
import { createLifecycleFinishTool } from "./finish";
import { createLifecycleRecordArtifactTool } from "./record-artifact";
import { createLifecycleStartRequestTool } from "./start-request";

export interface LifecycleTools {
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
}

export function createLifecycleTools(handle: LifecycleHandle): LifecycleTools {
  return {
    lifecycle_start_request: createLifecycleStartRequestTool(handle),
    lifecycle_record_artifact: createLifecycleRecordArtifactTool(handle),
    lifecycle_commit: createLifecycleCommitTool(handle),
    lifecycle_finish: createLifecycleFinishTool(handle),
  };
}
