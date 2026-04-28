import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createProjectMemoryStore } from "@/project-memory/store";
import { createArtifactIndex } from "@/tools/artifact-index";
import { createMindmodelLookupTool } from "@/tools/mindmodel-lookup";

const ARTIFACT_SEARCH_SOURCE = "src/tools/artifact-search.ts";
const ARTIFACT_INDEX_SOURCE = "src/tools/artifact-index/index.ts";
const INDEX_SOURCE = "src/index.ts";
const LEGACY_KIND = "handoff";
const ARTIFACT_DB_NAME = "context.db";
const SCRATCH_PREFIX = "project-memory-compatibility-";
const PROJECT_ID = "project-compatibility";
const ENTITY_ID = "entity-memory";
const MEMORY_ENTRY_ID = "entry-memory";
const MILESTONE_ID = "milestone-compatibility";
const MILESTONE_ARTIFACT_ID = "milestone-artifact-compatibility";
const MILESTONE_QUERY = "compatibility cache";
const CREATED_AT = 1;
const UPDATED_AT = 2;
const SEARCH_LIMIT = 5;
const MILESTONE_SEARCH_FUNCTION = "searchMilestoneArtifactsInDb";
const FUNCTION_MARKER = "\nfunction ";
const MILESTONE_TABLE = "milestone_artifacts_fts";
const NON_MILESTONE_FTS_TABLES = ["plans_fts", "ledgers_fts", "entries_fts"] as const;
const LEDGER_COMMAND_NAME = "ledger";
const SEARCH_COMMAND_NAME = "search";
const LEDGER_COMMAND: CommandDefinition = {
  description: "Create or update continuity ledger for session state",
  agent: "ledger-creator",
  template: "Update the continuity ledger. $ARGUMENTS",
};
const SEARCH_COMMAND: CommandDefinition = {
  description: "Search past handoffs, plans, and ledgers",
  agent: "artifact-searcher",
  template: "Search for: $ARGUMENTS",
};
const NO_MINDMODEL_DIRECTORY = "No .mindmodel/ directory found in this project. Proceed without specific patterns.";
const TOOL_CONTEXT = {} as ToolContext;

interface CommandDefinition {
  readonly description: string;
  readonly agent: string;
  readonly template: string;
}

type ToolExecute = (raw: unknown, context: ToolContext) => Promise<ToolResult>;

const scratchDirs: string[] = [];

function createScratchDir(): string {
  const directory = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  scratchDirs.push(directory);
  return directory;
}

function createContext(directory: string): PluginInput {
  return { directory } as PluginInput;
}

function stringify(toolOutput: ToolResult): string {
  if (typeof toolOutput === "string") return toolOutput;
  return toolOutput.output;
}

async function executeTool(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as ToolExecute;
  return stringify(await execute(args, TOOL_CONTEXT));
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf(FUNCTION_MARKER, start + 1);
  if (next === -1) return source.slice(start);
  return source.slice(start, next);
}

function commandDefinition(source: string, command: string): CommandDefinition {
  const pattern = new RegExp(
    [
      `${command}:\\s*\\{`,
      `\\s*description:\\s*"([^"]+)",`,
      `\\s*agent:\\s*"([^"]+)",`,
      `\\s*template:\\s*"([^"]+)",?\\s*\\}`,
    ].join(""),
  );
  const match = pattern.exec(source);
  expect(match).not.toBeNull();
  return {
    description: match?.[1] ?? "",
    agent: match?.[2] ?? "",
    template: match?.[3] ?? "",
  };
}

async function addMemoryTablesToArtifactDb(directory: string): Promise<void> {
  const store = createProjectMemoryStore({ dbDir: directory, dbFileName: ARTIFACT_DB_NAME });
  await store.initialize();
  try {
    await store.upsertEntity({
      projectId: PROJECT_ID,
      id: ENTITY_ID,
      kind: "module",
      name: "memory",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    await store.upsertEntry({
      projectId: PROJECT_ID,
      id: MEMORY_ENTRY_ID,
      entityId: ENTITY_ID,
      type: "decision",
      title: MILESTONE_QUERY,
      summary: "compatibility cache entry from project memory",
      status: "active",
      sensitivity: "internal",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  } finally {
    await store.close();
  }
}

describe("project memory compatibility", () => {
  afterEach(() => {
    for (const directory of scratchDirs) {
      rmSync(directory, { recursive: true, force: true });
    }
    scratchDirs.length = 0;
  });

  it("keeps artifact_search source free of the legacy artifact kind", async () => {
    const source = await readFile(ARTIFACT_SEARCH_SOURCE, "utf-8");
    expect(source).not.toContain(LEGACY_KIND);
  });

  it("keeps milestone artifact search scoped to milestone_artifacts_fts", async () => {
    const directory = createScratchDir();
    await addMemoryTablesToArtifactDb(directory);
    const index = createArtifactIndex(directory);
    await index.initialize();

    try {
      await index.indexMilestoneArtifact({
        id: MILESTONE_ARTIFACT_ID,
        milestoneId: MILESTONE_ID,
        artifactType: "decision",
        payload: "compatibility cache milestone payload",
        tags: ["compatibility"],
      });
      const hits = await index.searchMilestoneArtifacts(MILESTONE_QUERY, {
        milestoneId: MILESTONE_ID,
        limit: SEARCH_LIMIT,
      });

      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe(MILESTONE_ARTIFACT_ID);
    } finally {
      await index.close();
    }

    const source = await readFile(ARTIFACT_INDEX_SOURCE, "utf-8");
    const milestoneSearch = extractFunction(source, MILESTONE_SEARCH_FUNCTION);
    expect(milestoneSearch).toContain(`FROM ${MILESTONE_TABLE}`);
    for (const table of NON_MILESTONE_FTS_TABLES) {
      expect(milestoneSearch).not.toContain(table);
    }
  });

  it("keeps mindmodel_lookup no-directory response", async () => {
    const directory = createScratchDir();
    const tools = createMindmodelLookupTool(createContext(directory));
    const output = await executeTool(tools.mindmodel_lookup, { query: "component patterns" });

    expect(output).toBe(NO_MINDMODEL_DIRECTORY);
  });

  it("keeps ledger and search command definitions unchanged", async () => {
    const source = await readFile(INDEX_SOURCE, "utf-8");

    expect(commandDefinition(source, LEDGER_COMMAND_NAME)).toEqual(LEDGER_COMMAND);
    expect(commandDefinition(source, SEARCH_COMMAND_NAME)).toEqual(SEARCH_COMMAND);
  });
});
