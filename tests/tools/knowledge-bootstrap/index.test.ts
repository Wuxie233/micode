import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { createDetectKnowledgeStateTool } from "@/tools/knowledge-bootstrap";

let projectRoot: string;

function ctx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-tool-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createDetectKnowledgeStateTool", () => {
  it("returns a tool object with detect_knowledge_state", () => {
    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    expect(tools.detect_knowledge_state).toBeDefined();
  });

  it("executing the tool reports an empty project's three layers as missing", async () => {
    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    const result = (await tools.detect_knowledge_state.execute({}, {} as never)) as string;
    expect(typeof result).toBe("string");
    expect(result).toContain("missing");
    expect(result).toContain("init");
    expect(result).toContain("mindmodel");
    expect(result).toContain("atlas");
  });

  it("executing the tool reports present layers after files are created", async () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");

    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    const result = (await tools.detect_knowledge_state.execute({}, {} as never)) as string;
    expect(result).toContain("present");
    // ensure all three layers appear in the report
    expect(result.match(/present/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
