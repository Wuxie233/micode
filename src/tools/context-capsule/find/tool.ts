import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";
import { hashText } from "@/agents/context-capsule/format";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import {
  DEFAULT_CONTEXT_CAPSULE_DIRECTORY,
  findReusableContextCapsule,
  parseContextCapsuleDocument,
} from "@/agents/context-capsule/store";
import type { ContextCapsuleFreshnessResult, ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";
import { extractErrorMessage } from "@/utils/errors";
import { type FindReusableContextCapsuleArgs, findReusableContextCapsuleArgs } from "./args";

type ExtendedToolContext = ToolContext & { readonly sessionID?: string };

interface GitEnvironment {
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
}

const DESCRIPTION = `Find the newest reusable Working Context Capsule for the current lifecycle or conversation.
The tool is read-only: it derives git/worktree metadata, resolves the current conversation anchor from the caller session, and returns a compact markdown reference for an existing capsule without writing files.`;

async function readGitValue(directory: string, args: readonly string[]): Promise<string> {
  const result = await $`git ${args}`.cwd(directory).quiet();
  return result.stdout.toString().trim();
}

async function readGitEnvironment(directory: string): Promise<GitEnvironment> {
  const [branch, headSha, worktree] = await Promise.all([
    readGitValue(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    readGitValue(directory, ["rev-parse", "HEAD"]),
    readGitValue(directory, ["rev-parse", "--show-toplevel"]),
  ]);

  return { branch, headSha, worktree };
}

function hasFrontmatter(document: string): boolean {
  return document.startsWith("---\n") && document.indexOf("\n---", "---\n".length) !== -1;
}

function capsuleIsBeforeSince(frontmatter: ContextCapsuleFrontmatter, since: string | undefined): boolean {
  if (!since) return false;

  const sinceTime = Date.parse(since);
  const createdAt = Date.parse(frontmatter.created_at);
  if (Number.isNaN(sinceTime) || Number.isNaN(createdAt)) return false;
  return createdAt < sinceTime;
}

async function readSourceHashes(
  worktree: string,
  frontmatter: ContextCapsuleFrontmatter,
): Promise<Record<string, string>> {
  const sourceFiles = new Set([...frontmatter.source_files, ...Object.keys(frontmatter.source_hashes)]);
  const hashes: Record<string, string> = {};

  await Promise.all(
    [...sourceFiles].map(async (sourceFile) => {
      try {
        hashes[sourceFile] = hashText(await readFile(join(worktree, sourceFile), "utf-8"));
      } catch {
        hashes[sourceFile] = "";
      }
    }),
  );

  return hashes;
}

async function evaluateFreshness(
  refContent: string,
  git: GitEnvironment,
  lifecycleIssue: number | null,
  conversationAnchor: string | null,
): Promise<ContextCapsuleFreshnessResult | null> {
  if (!hasFrontmatter(refContent)) return null;

  const { frontmatter } = parseContextCapsuleDocument(refContent);
  const sourceHashes = await readSourceHashes(git.worktree, frontmatter);
  const expectedConversationAnchor = lifecycleIssue === null ? conversationAnchor : undefined;

  return evaluateContextCapsuleFreshness({
    expectedLifecycleIssue: lifecycleIssue,
    expectedConversationAnchor,
    branch: git.branch,
    headSha: git.headSha,
    worktree: git.worktree,
    sourceHashes,
    frontmatter,
  });
}

function formatFreshness(freshness: ContextCapsuleFreshnessResult | null): string {
  if (freshness === null) return "freshness: no-frontmatter";
  const lines = [`freshness: ${freshness.status}`];
  if (freshness.reasons.length > 0) lines.push(`freshness_reasons: ${freshness.reasons.join(", ")}`);
  if (freshness.staleSourceFiles.length > 0) lines.push(`stale_source_files: ${freshness.staleSourceFiles.join(", ")}`);
  return lines.join("\n");
}

function formatNoReusable(topicHint: string | undefined): string {
  const lines = ["## No reusable capsule"];
  if (topicHint) lines.push("", `topic_hint: ${topicHint}`);
  return lines.join("\n");
}

async function executeFindReusableContextCapsule(
  ctx: PluginInput,
  args: FindReusableContextCapsuleArgs,
  toolCtx: ToolContext,
): Promise<string> {
  const lifecycleIssue = args.lifecycle_issue ?? null;
  const conversationAnchor = resolveConversationAnchor((toolCtx as ExtendedToolContext).sessionID);

  if (conversationAnchor === null && lifecycleIssue === null) {
    return "## Context capsule skipped\n\nskipped: no-conversation-anchor";
  }

  const git = await readGitEnvironment(ctx.directory);
  const ref = await findReusableContextCapsule({
    directory: join(git.worktree, DEFAULT_CONTEXT_CAPSULE_DIRECTORY),
    lifecycleIssue,
    conversationAnchor,
    branch: git.branch,
    worktree: git.worktree,
  });

  if (ref === null) return formatNoReusable(args.topic_hint);

  const { frontmatter } = parseContextCapsuleDocument(ref.content);
  if (capsuleIsBeforeSince(frontmatter, args.since)) return formatNoReusable(args.topic_hint);

  const freshness = await evaluateFreshness(ref.content, git, lifecycleIssue, conversationAnchor);
  const lines = [
    "## Reusable context capsule",
    "",
    `path: ${ref.path}`,
    `sha: ${ref.sha}`,
    `token: ${ref.token}`,
    formatFreshness(freshness),
  ];
  if (args.topic_hint) lines.push(`topic_hint: ${args.topic_hint}`);
  return lines.join("\n");
}

export function createFindReusableContextCapsuleTool(ctx: PluginInput): {
  find_reusable_context_capsule: ToolDefinition;
} {
  const find_reusable_context_capsule = tool({
    description: DESCRIPTION,
    args: findReusableContextCapsuleArgs,
    execute: async (args, toolCtx) => {
      try {
        return await executeFindReusableContextCapsule(ctx, args as FindReusableContextCapsuleArgs, toolCtx);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { find_reusable_context_capsule };
}
