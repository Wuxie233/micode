import type { PluginInput } from "@opencode-ai/plugin";

import { getAtlasSummary } from "@/atlas/auto-inject";

/**
 * Agents that get atlas context auto-injected into their system prompt.
 *
 * commander is intentionally excluded: it is a triage / routing agent that
 * frequently handles quick-op or no-op classification work, where pre-loading
 * the atlas summary wastes tokens. commander can still call the `atlas_lookup`
 * tool on demand when its routing decision actually needs project map context.
 *
 * Other subagents (executor, reviewer, implementer-*, etc.) are also excluded
 * for the same token-budget reason: they receive task-scoped instructions from
 * their parent agent and do not need the global atlas summary.
 */
const ATLAS_AUTO_INJECT_AGENTS: ReadonlySet<string> = new Set(["brainstormer", "planner"]);

const ATLAS_CONTEXT_HEADER =
  "The following is an auto-injected summary of the project's Atlas knowledge graph. " +
  "Use it as your starting map of the project. " +
  "When you need a deeper view of any node, call the `atlas_lookup` tool.";

interface AtlasAutoInjectHook {
  readonly "chat.params": (
    _input: { readonly sessionID: string },
    output: { options?: Record<string, unknown>; system?: string },
  ) => Promise<void>;
}

const wrapAtlasContext = (summary: string): string =>
  `<atlas-context>\n${ATLAS_CONTEXT_HEADER}\n\n${summary}\n</atlas-context>`;

const safeGetSummary = async (projectRoot: string): Promise<string | null> => {
  try {
    return await getAtlasSummary(projectRoot);
  } catch {
    // Atlas read failure must never block the main agent flow.
    return null;
  }
};

export function createAtlasAutoInjectHook(ctx: PluginInput): AtlasAutoInjectHook {
  return {
    "chat.params": async (_input, output) => {
      const agent = output.options?.agent as string | undefined;
      if (!agent || !ATLAS_AUTO_INJECT_AGENTS.has(agent)) return;

      const summary = await safeGetSummary(ctx.directory);
      if (summary === null || summary.trim().length === 0) return;

      const block = wrapAtlasContext(summary);
      output.system = output.system ? `${block}\n\n${output.system}` : block;
    },
  };
}
