import { describe, expect, it } from "bun:test";

import { EntryTypeValues } from "@/project-memory";
import { createProjectMemoryLookupTool } from "@/tools/project-memory/lookup";

interface ParseResult {
  readonly success: boolean;
}

interface ToolArgSchema {
  safeParse(value: unknown): ParseResult;
}

const TOOL_CONTEXT = { directory: process.cwd() } as Parameters<typeof createProjectMemoryLookupTool>[0];

function toolArgs(): Record<string, ToolArgSchema> {
  const { project_memory_lookup } = createProjectMemoryLookupTool(TOOL_CONTEXT);
  return project_memory_lookup.args as Record<string, ToolArgSchema>;
}

describe("project_memory_lookup tool contract", () => {
  it("describes project memory procedures", () => {
    const { project_memory_lookup } = createProjectMemoryLookupTool(TOOL_CONTEXT);

    expect(String(project_memory_lookup.description ?? "")).toContain("procedures");
  });

  it("accepts procedure through EntryTypeValues", () => {
    expect(EntryTypeValues).toContain("procedure");
    expect(toolArgs().type.safeParse("procedure").success).toBe(true);
  });

  it("exposes only public and internal sensitivity ceilings", () => {
    const args = toolArgs();

    expect(args.sensitivity_ceiling.safeParse("public").success).toBe(true);
    expect(args.sensitivity_ceiling.safeParse("internal").success).toBe(true);
    expect(args.sensitivity_ceiling.safeParse("secret").success).toBe(false);
  });
});
