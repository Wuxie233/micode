import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import { $ } from "bun";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import { createProjectMemoryPromoteTool } from "@/tools/project-memory/promote";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { resolveProjectId } from "@/utils/project-id";

const TOOL_CONTEXT = {} as unknown as ToolContext;
const ORIGIN_URL = "https://github.com/Wuxie233/micode.git";
const ENTITY_NAME = "project-memory";
const SOURCE_KIND = "lifecycle";
const POINTER = "thoughts/lifecycle/secret-rejection.md";
const REAL_DECISION = "Cache permission lookups for 30s";
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET_DECISION = `Use AWS access key ${FAKE_AWS_KEY} for a fixture`;
const PROMOTION_MARKDOWN = `## Decisions
- ${REAL_DECISION}
- ${SECRET_DECISION}
`;
const EXPECTED_SECRET_REASON = "secret: aws_access_key";
const EXPECTED_ENTRY_COUNT = 1;

let root: string;
let store: ProjectMemoryStore;

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

function stringify(outcome: ToolResult): string {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
}

async function callExecute(toolDef: ToolDefinition, raw: unknown): Promise<string> {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec(raw, TOOL_CONTEXT));
}

function createCtx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

async function createOriginRepo(): Promise<string> {
  const directory = join(root, "repo");
  mkdirSync(directory);
  await $`git init -q`.cwd(directory);
  await $`git remote add origin ${ORIGIN_URL}`.cwd(directory);
  return directory;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-memory-secret-rejection-"));
  store = createProjectMemoryStore({ dbDir: join(root, "db") });
  setProjectMemoryStoreForTest(store);
});

afterEach(async () => {
  try {
    await resetProjectMemoryRuntimeForTest();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("project_memory_promote secret rejection", () => {
  it("accepts clean decisions and rejects AWS key bullets", async () => {
    const directory = await createOriginRepo();
    const toolDef = createProjectMemoryPromoteTool(createCtx(directory)).project_memory_promote;

    const output = await callExecute(toolDef, {
      markdown: PROMOTION_MARKDOWN,
      entity_name: ENTITY_NAME,
      source_kind: SOURCE_KIND,
      pointer: POINTER,
    });
    const identity = await resolveProjectId(directory);

    expect(identity.kind).toBe("origin");
    expect(output).toContain("## Project memory promoted");
    expect(output).toContain(REAL_DECISION);
    expect(output).toContain(`| ${SECRET_DECISION} | ${EXPECTED_SECRET_REASON} |`);
    expect(output).toContain("**Note**: 1 accepted, 1 rejected");
    expect(await store.countEntries(identity.projectId)).toBe(EXPECTED_ENTRY_COUNT);
  });
});
