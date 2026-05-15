import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { OpenCodeConfigPlugin } from "@/index";
import { stopSharedServer } from "@/octto/session/server";
import { createProjectMemoryMaintainTool } from "@/tools";
import { createProjectMemoryMaintainTool as createProjectMemoryMaintainToolFromProjectMemory } from "@/tools/project-memory";
import { config } from "@/utils/config";

const SESSION_ID = "project-memory-index-test-session";
const PREFIX = "pm-index-tool-map-";

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

describe("project memory tool barrels", () => {
  it("re-exports createProjectMemoryMaintainTool from project-memory and top-level barrels", () => {
    expect(typeof createProjectMemoryMaintainToolFromProjectMemory).toBe("function");
    expect(typeof createProjectMemoryMaintainTool).toBe("function");
    expect(createProjectMemoryMaintainTool).toBe(createProjectMemoryMaintainToolFromProjectMemory);
  });

  it("registers project_memory_maintain in the plugin tool map", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    setPersistedSessionsDir(tempRoot);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));

      expect(Object.keys(plugin.tool ?? {})).toContain("project_memory_maintain");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
