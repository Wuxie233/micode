// tests/index.test.ts
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "../src/index";
import { stopSharedServer } from "../src/octto/session/server";
import { config } from "../src/utils/config";

const ISSUE_WORKFLOW_TOOL_KEYS = [
  "lifecycle_start_request",
  "lifecycle_record_artifact",
  "lifecycle_commit",
  "lifecycle_finish",
  "resume_subagent",
] as const;
const PREFIX = "micode-index-tools-";
const SESSION_ID = "index-tools-session";

const originalPersistedSessionsDir = config.octto.persistedSessionsDir;
let tempRoot: string | undefined;

function restorePersistedSessionsDir(): void {
  Object.defineProperty(config.octto, "persistedSessionsDir", {
    configurable: true,
    value: originalPersistedSessionsDir,
    writable: true,
  });
}

function setPersistedSessionsDir(baseDir: string): void {
  Object.defineProperty(config.octto, "persistedSessionsDir", {
    configurable: true,
    value: join(baseDir, "sessions"),
    writable: true,
  });
}

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: SESSION_ID } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: SESSION_ID } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: SESSION_ID } }),
        summarize: async () => ({ data: { id: SESSION_ID } }),
      },
      tui: {
        showToast: async () => undefined,
      },
    },
  } as unknown as PluginInput;
}

afterEach(async () => {
  await stopSharedServer();
  restorePersistedSessionsDir();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("index.ts constraint-reviewer integration", () => {
  it("should import createConstraintReviewerHook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    expect(source).toContain("createConstraintReviewerHook");
  });

  it("should create the constraint reviewer hook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be created with a review function
    expect(source).toContain("constraintReviewerHook");
    expect(source).toContain("createConstraintReviewerHook(ctx");
  });

  it("should call constraint reviewer hook in tool.execute.after", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the tool.execute.after handler
    expect(source).toContain('constraintReviewerHook["tool.execute.after"]');
  });

  it("should call constraint reviewer hook in chat.message", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the chat.message handler
    expect(source).toContain('constraintReviewerHook["chat.message"]');
  });

  it("should use mm-constraint-reviewer agent for review", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The review function should use the mm-constraint-reviewer agent
    expect(source).toContain("mm-constraint-reviewer");
  });
});

describe("index.ts commands", () => {
  it("should use project-initializer agent for /init command", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The /init command should use project-initializer
    const initCommandMatch = source.match(/init:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(initCommandMatch).not.toBeNull();
    expect(initCommandMatch?.[1]).toBe("project-initializer");
  });

  it("should use mm-orchestrator agent for /mindmodel command", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The /mindmodel command should use mm-orchestrator
    const mindmodelMatch = source.match(/mindmodel:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(mindmodelMatch).not.toBeNull();
    expect(mindmodelMatch?.[1]).toBe("mm-orchestrator");
  });
});

describe("index.ts issue workflow tools", () => {
  it("should expose issue workflow tools from the returned tool map", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    setPersistedSessionsDir(tempRoot);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const keys = Object.keys(plugin.tool ?? {});

      for (const key of ISSUE_WORKFLOW_TOOL_KEYS) {
        expect(keys).toContain(key);
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
