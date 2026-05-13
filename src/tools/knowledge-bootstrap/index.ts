import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { detectKnowledgeState } from "./detect";
import type { KnowledgeState } from "./types";

const DESCRIPTION = `Detect which of the three project knowledge layers are present on disk:
- /init layer (ARCHITECTURE.md + CODE_STYLE.md)
- .mindmodel/ layer (.mindmodel/manifest.yaml)
- atlas/ layer (atlas/00-index.md)

Returns a markdown report. Used by the knowledge-bootstrap-orchestrator agent at the start of
/all-init, /all-rebuild, and /all-status to plan which sub-orchestrators to spawn.`;

const HEADER = "## Knowledge State";
const ISO_DATE_LENGTH = 10;

function formatPresence(label: string, exists: boolean, mtime?: Date): string {
  const status = exists ? "exists" : "missing";
  const mtimeText = exists && mtime ? ` (mtime ${mtime.toISOString().slice(0, ISO_DATE_LENGTH)})` : "";
  return `  - ${label}: ${status}${mtimeText}`;
}

function formatState(state: KnowledgeState): string {
  return [
    HEADER,
    `- init layer: ${state.init}`,
    formatPresence("ARCHITECTURE.md", state.files.architectureMd.exists, state.files.architectureMd.mtime),
    formatPresence("CODE_STYLE.md", state.files.codeStyleMd.exists, state.files.codeStyleMd.mtime),
    `- mindmodel layer: ${state.mindmodel}`,
    formatPresence(
      ".mindmodel/manifest.yaml",
      state.files.mindmodelManifest.exists,
      state.files.mindmodelManifest.mtime,
    ),
    `- atlas layer: ${state.atlas}`,
    formatPresence("atlas/00-index.md", state.files.atlasIndex.exists, state.files.atlasIndex.mtime),
    `- project memory: entries=${state.projectMemory.entries}, healthy=${state.projectMemory.healthy}`,
  ].join("\n");
}

export function createDetectKnowledgeStateTool(ctx: PluginInput): { detect_knowledge_state: ToolDefinition } {
  const detect_knowledge_state = tool({
    description: DESCRIPTION,
    args: {},
    execute: async () => {
      const state = detectKnowledgeState(ctx.directory);
      return formatState(state);
    },
  });
  return { detect_knowledge_state };
}

export { detectKnowledgeState } from "./detect";
export { type AtlasStatusResult, renderBootstrapStatus } from "./status";
export type { FilePresence, KnowledgeState, LayerState, ProjectMemorySummary } from "./types";
