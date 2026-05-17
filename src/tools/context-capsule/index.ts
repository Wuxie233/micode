import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { createBuildContextCapsuleTool } from "./build/tool";
import { createFindReusableContextCapsuleTool } from "./find/tool";

export interface ContextCapsuleTools {
  readonly find_reusable_context_capsule: ToolDefinition;
  readonly build_context_capsule: ToolDefinition;
}

export function createContextCapsuleTools(ctx: PluginInput): ContextCapsuleTools {
  return {
    ...createFindReusableContextCapsuleTool(ctx),
    ...createBuildContextCapsuleTool(ctx),
  };
}
