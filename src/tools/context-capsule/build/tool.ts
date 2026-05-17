import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";
import type { BuildContextCapsuleResult } from "@/agents/context-capsule/types";
import { extractErrorMessage } from "@/utils/errors";
import { type BuildContextCapsuleArgs, buildContextCapsuleArgs } from "./args";

type ExtendedToolContext = ToolContext & { readonly sessionID?: string };

interface GitEnvironment {
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
}

const DESCRIPTION = `Build an immutable Working Context Capsule for the current lifecycle or conversation.
The tool derives git/worktree metadata, resolves the current conversation anchor from the caller session, and delegates writing plus safety checks to the v2 context capsule builder.`;

async function readGitValue(directory: string, args: readonly string[]): Promise<string> {
  const result = await $`git ${args}`.cwd(directory).quiet();
  return result.stdout.toString().trim();
}

async function readGitEnvironment(directory: string): Promise<GitEnvironment | null> {
  try {
    const [branch, headSha, worktree] = await Promise.all([
      readGitValue(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
      readGitValue(directory, ["rev-parse", "HEAD"]),
      readGitValue(directory, ["rev-parse", "--show-toplevel"]),
    ]);

    if (!branch || !headSha || !worktree) return null;
    return { branch, headSha, worktree };
  } catch {
    return null;
  }
}

function formatSkippedGitUnavailable(): string {
  return "## Context capsule skipped\n\nskipped: git-env-unavailable";
}

function formatWarnings(warnings: readonly string[]): string {
  if (warnings.length === 0) return "warnings: none";
  return ["warnings:", ...warnings.map((warning) => `- ${warning}`)].join("\n");
}

function formatBuildResult(result: BuildContextCapsuleResult): string {
  if (result.status === "blocked") {
    const lines = ["## Context capsule blocked", "", `reason: ${result.reason}`];
    if (result.detail) lines.push(`detail: ${result.detail}`);
    return lines.join("\n");
  }

  return [
    "## Context capsule built",
    "",
    `path: ${result.path}`,
    `sha: ${result.sha}`,
    `token: ${result.token}`,
    formatWarnings(result.warnings),
  ].join("\n");
}

export function createBuildContextCapsuleTool(ctx: PluginInput): { build_context_capsule: ToolDefinition } {
  const build_context_capsule = tool({
    description: DESCRIPTION,
    args: buildContextCapsuleArgs,
    execute: async (args, toolCtx) => {
      try {
        const input = args as BuildContextCapsuleArgs;
        const git = await readGitEnvironment(ctx.directory);
        if (git === null) return formatSkippedGitUnavailable();

        const result = buildContextCapsule({
          topic: input.topic,
          lifecycleIssue: input.lifecycle_issue ?? null,
          branch: git.branch,
          headSha: git.headSha,
          worktree: git.worktree,
          sourceFiles: input.source_files ?? [],
          confirmedFacts: input.confirmed_facts ?? [],
          conversationAnchor: resolveConversationAnchor((toolCtx as ExtendedToolContext).sessionID),
          generatedBy: input.generated_by ?? null,
          dispatchKind: input.dispatch_kind ?? null,
          parentCapsuleSha: input.parent_capsule_sha ?? null,
        });

        return formatBuildResult(result);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { build_context_capsule };
}
