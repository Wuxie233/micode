import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { parseContextCapsuleDocument } from "@/agents/context-capsule/store";
import { createBuildContextCapsuleTool } from "@/tools/context-capsule/build/tool";

const CONTEXT_CAPSULE_DIRECTORY = "thoughts/shared/context-capsules";
const TOOL_CONTEXT = { sessionID: "build-session-a" } as ToolContext;

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

async function listCapsules(worktree: string): Promise<readonly string[]> {
  try {
    return await readdir(join(worktree, CONTEXT_CAPSULE_DIRECTORY));
  } catch {
    return [];
  }
}

describe("build_context_capsule", () => {
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "build-capsule-tool-"));
    await Bun.$`git init -b main`.cwd(directory).quiet();
    writeFileSync(join(directory, "README.md"), "capsule fixture\n");
    await Bun.$`git add README.md`.cwd(directory).quiet();
    await Bun.$`git -c user.name=Test -c user.email=test@example.com commit -m init`.cwd(directory).quiet();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("writes a fresh capsule under thoughts/shared/context-capsules", async () => {
    const tools = createBuildContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.build_context_capsule, {
      topic: "Working Context Capsule v3",
      lifecycle_issue: 99,
      confirmed_facts: ["build tool derives git metadata"],
      source_files: [{ path: "README.md", content: "capsule fixture\n" }],
      dispatch_kind: "parallel-fanout",
      generated_by: "executor",
    });
    const capsules = await listCapsules(directory);

    expect(output).toContain("## Context capsule built");
    expect(capsules).toHaveLength(1);

    const capsulePath = join(directory, CONTEXT_CAPSULE_DIRECTORY, capsules[0]);
    expect(relative(directory, capsulePath).startsWith(`${CONTEXT_CAPSULE_DIRECTORY}/`)).toBe(true);
    expect(output).toContain(`path: ${capsulePath}`);

    const { frontmatter, body } = parseContextCapsuleDocument(await readFile(capsulePath, "utf-8"));
    expect(frontmatter.lifecycle_issue).toBe(99);
    expect(frontmatter.branch).toBe("main");
    expect(frontmatter.worktree).toBe(directory);
    expect(frontmatter.source_files).toEqual(["README.md"]);
    expect(frontmatter.dispatch_kind).toBe("parallel-fanout");
    expect(frontmatter.generated_by).toBe("executor");
    expect(body).toContain("build tool derives git metadata");
  });

  it("blocks source-of-truth v2 secret pattern and writes no capsule file", async () => {
    const tools = createBuildContextCapsuleTool({ directory } as PluginInput);
    const output = await executeTool(tools.build_context_capsule, {
      topic: "leak",
      lifecycle_issue: null,
      confirmed_facts: ["Authorization: Bearer abcdef1234567890"],
      source_files: [],
      dispatch_kind: "single-subagent",
      generated_by: "commander",
    });

    expect(output).toContain("## Context capsule blocked");
    expect(output).toContain("reason: secret_detected");
    expect(await listCapsules(directory)).toEqual([]);
  });

  it("skips without writing when git metadata is unavailable", async () => {
    const nonGitDirectory = mkdtempSync(join(tmpdir(), "build-capsule-non-git-"));
    try {
      const tools = createBuildContextCapsuleTool({ directory: nonGitDirectory } as PluginInput);
      const output = await executeTool(tools.build_context_capsule, {
        topic: "non-git",
        confirmed_facts: ["fact"],
        source_files: [],
      });

      expect(output).toBe("## Context capsule skipped\n\nskipped: git-env-unavailable");
      expect(await listCapsules(nonGitDirectory)).toEqual([]);
    } finally {
      rmSync(nonGitDirectory, { recursive: true, force: true });
    }
  });
});
