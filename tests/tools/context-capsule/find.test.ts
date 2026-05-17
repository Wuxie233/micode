import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { hashText, renderCapsuleDocument } from "@/agents/context-capsule/format";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";
import { createFindReusableContextCapsuleTool } from "@/tools/context-capsule/find/tool";

const CONTEXT_CAPSULE_DIRECTORY = "thoughts/shared/context-capsules";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const SESSION_ANCHOR = hashText("session-a").slice(0, 16);
const OTHER_ANCHOR = "other-anchor";
const TOOL_CONTEXT = { sessionID: "session-a" } as ToolContext;
const EMPTY_TOOL_CONTEXT = {} as ToolContext;

type ExecuteSignature = (raw: unknown, context: ToolContext) => Promise<ToolResult>;

function stringify(result: ToolResult): string {
  if (typeof result === "string") return result;
  return result.output;
}

async function executeTool(
  toolDef: ToolDefinition,
  args: Record<string, unknown>,
  context = TOOL_CONTEXT,
): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as ExecuteSignature;
  return stringify(await execute(args, context));
}

function capsuleFrontmatter(
  worktree: string,
  overrides: Partial<ContextCapsuleFrontmatter> = {},
): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: null,
    branch: "main",
    head_sha: HEAD_SHA,
    worktree,
    created_at: "2026-05-17T00:00:00.000Z",
    source_files: [],
    source_hashes: {},
    conversation_anchor: SESSION_ANCHOR,
    generated_by: "commander",
    dispatch_kind: "single-subagent",
    parent_capsule: null,
    ...overrides,
  };
}

async function writeCapsule(worktree: string, filename: string, frontmatter: ContextCapsuleFrontmatter): Promise<void> {
  const directory = join(worktree, CONTEXT_CAPSULE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), renderCapsuleDocument(frontmatter, "## Context\n\nconfirmed."));
}

async function listCapsules(worktree: string): Promise<readonly string[]> {
  try {
    return await readdir(join(worktree, CONTEXT_CAPSULE_DIRECTORY));
  } catch {
    return [];
  }
}

describe("find_reusable_context_capsule", () => {
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "find-capsule-tool-"));
    await Bun.$`git init -b main`.cwd(directory).quiet();
    writeFileSync(join(directory, "README.md"), "capsule fixture\n");
    await Bun.$`git add README.md`.cwd(directory).quiet();
    await Bun.$`git -c user.name=Test -c user.email=test@example.com commit -m init`.cwd(directory).quiet();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("skips when neither lifecycle nor conversation anchor is available", async () => {
    const tools = createFindReusableContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.find_reusable_context_capsule, {}, EMPTY_TOOL_CONTEXT);

    expect(output).toBe("## Context capsule skipped\n\nskipped: no-conversation-anchor");
  });

  it("returns no reusable capsule when no matching capsule exists", async () => {
    const tools = createFindReusableContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.find_reusable_context_capsule, { topic_hint: "missing" });

    expect(output).toContain("## No reusable capsule");
    expect(output).toContain("topic_hint: missing");
  });

  it("is read-only and does not write capsule files", async () => {
    const tools = createFindReusableContextCapsuleTool({ directory } as PluginInput);
    const before = await listCapsules(directory);
    const output = await executeTool(tools.find_reusable_context_capsule, { topic_hint: "readonly" });
    const after = await listCapsules(directory);

    expect(output).toContain("## No reusable capsule");
    expect(after).toEqual(before);
  });

  it("returns a freshness verdict for a matching conversation capsule", async () => {
    const currentHead = (await Bun.$`git rev-parse HEAD`.cwd(directory).quiet()).stdout.toString().trim();
    await writeCapsule(
      directory,
      "conversation.md",
      capsuleFrontmatter(directory, {
        head_sha: currentHead,
        source_files: ["README.md"],
        source_hashes: { "README.md": hashText("old readme") },
      }),
    );
    const tools = createFindReusableContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.find_reusable_context_capsule, { topic_hint: "freshness" });

    expect(output).toContain("## Reusable context capsule");
    expect(output).toContain("freshness: partially-stale");
    expect(output).toContain("freshness_reasons: source_hashes_changed");
    expect(output).toContain("stale_source_files: README.md");
    expect(output).toContain("topic_hint: freshness");
  });

  it("keeps a lifecycle match reusable when the current conversation anchor differs", async () => {
    const currentHead = (await Bun.$`git rev-parse HEAD`.cwd(directory).quiet()).stdout.toString().trim();
    await writeCapsule(
      directory,
      "issue-99-lifecycle.md",
      capsuleFrontmatter(directory, {
        lifecycle_issue: 99,
        head_sha: currentHead,
        conversation_anchor: OTHER_ANCHOR,
      }),
    );
    const tools = createFindReusableContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.find_reusable_context_capsule, { lifecycle_issue: 99 });

    expect(output).toContain("## Reusable context capsule");
    expect(output).toContain("freshness: fresh");
    expect(output).not.toContain("conversation_anchor_mismatch");
    expect(output).not.toContain("freshness: discarded");
  });
});
