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
const ENTITY_NAME = "auth";
const POINTER = "thoughts/lifecycle/42.md";
const ACCEPTED_DECISION = "Cache permission lookups for 30s";
const STRIPE_PREFIX = "sk_live_";
const STRIPE_SUFFIX = "abcdefghijklmnopqrstuvwx";
const SECRET_DECISION = `Use API key ${STRIPE_PREFIX}${STRIPE_SUFFIX} for billing`;
const PROMOTION_MARKDOWN = `## Decisions
- ${ACCEPTED_DECISION}
- ${SECRET_DECISION}
`;
const EXPECTED_ACCEPTED = 1;

let root: string;
let store: ProjectMemoryStore;

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const callExecute = async (toolDef: ToolDefinition, args: unknown): Promise<string> => {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
};

const createCtx = (directory: string): PluginInput => ({ directory }) as unknown as PluginInput;

async function createOriginRepo(): Promise<string> {
  const directory = join(root, "repo");
  mkdirSync(directory);
  await $`git init -q`.cwd(directory);
  await $`git remote add origin ${ORIGIN_URL}`.cwd(directory);
  return directory;
}

function createPlainDirectory(): string {
  const directory = join(root, "plain");
  mkdirSync(directory);
  return directory;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-memory-promote-tool-"));
  store = createProjectMemoryStore({ dbDir: join(root, "db") });
  setProjectMemoryStoreForTest(store);
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  rmSync(root, { recursive: true, force: true });
});

describe("project_memory_promote tool", () => {
  it("returns accepted and rejected promotion summary tables", async () => {
    const directory = await createOriginRepo();
    const toolDef = createProjectMemoryPromoteTool(createCtx(directory)).project_memory_promote;

    const output = await callExecute(toolDef, {
      markdown: PROMOTION_MARKDOWN,
      entity_name: ENTITY_NAME,
      source_kind: "lifecycle",
      pointer: POINTER,
    });
    const identity = await resolveProjectId(directory);

    expect(output).toContain("## Project memory promoted");
    expect(output).toContain("| Entry ID | Title | Status |");
    expect(output).toContain(ACCEPTED_DECISION);
    expect(output).toContain("| Title | Reason |");
    expect(output).toContain("secret: stripe_secret_key");
    expect(output).toContain("**Note**: 1 accepted, 1 rejected");
    expect(await store.countEntries(identity.projectId)).toBe(EXPECTED_ACCEPTED);
  });

  it("refuses promotion when project identity is degraded", async () => {
    const directory = createPlainDirectory();
    const toolDef = createProjectMemoryPromoteTool(createCtx(directory)).project_memory_promote;

    const output = await callExecute(toolDef, {
      markdown: `## Decisions\n- ${ACCEPTED_DECISION}\n`,
      entity_name: ENTITY_NAME,
      source_kind: "lifecycle",
      pointer: POINTER,
    });
    const identity = await resolveProjectId(directory);

    expect(output).toContain("## Project memory promotion refused");
    expect(output.toLowerCase()).toContain("degraded identity");
    expect(await store.countEntries(identity.projectId)).toBe(0);
  });
});
