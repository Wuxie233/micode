// tests/index-all-commands-routing.test.ts
//
// Drift-guard test ensuring the three /all-* commands route to
// knowledge-bootstrap-orchestrator and that the atlas-command-execute-before
// hook does NOT intercept them.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin, shouldSkipAtlasCommandHook } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const PREFIX = "micode-all-commands-routing-";

let tempRoot: string | undefined;

interface CommandConfig {
  readonly agent?: string;
  readonly template?: string;
  readonly description?: string;
}

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: "test-session" } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: "test-session" } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: "test-session" } }),
        summarize: async () => ({ data: { id: "test-session" } }),
      },
      tui: { showToast: async () => undefined },
    },
  } as unknown as PluginInput;
}

async function loadCommands(): Promise<Record<string, CommandConfig>> {
  tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
  const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
  const configObj: Parameters<NonNullable<typeof plugin.config>>[0] = {
    permission: {},
    agent: {},
    mcp: {},
    command: {},
  } as Parameters<NonNullable<typeof plugin.config>>[0];
  await plugin.config?.(configObj);
  return (configObj.command ?? {}) as Record<string, CommandConfig>;
}

afterEach(async () => {
  await stopSharedServer();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("/all-* command routing", () => {
  it("routes /all-init to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("routes /all-rebuild to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-rebuild"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("routes /all-status to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-status"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("template injects mode hint for each command", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.template).toContain("missing-only");
    expect(commands["all-rebuild"]?.template).toContain("refresh-all");
    expect(commands["all-status"]?.template).toContain("status-only");
  });

  it("/all-rebuild template instructs confirm before overwrite", async () => {
    const commands = await loadCommands();
    expect(commands["all-rebuild"]?.template?.toLowerCase()).toContain("confirm");
  });

  it("/all-status template forbids writing files", async () => {
    const commands = await loadCommands();
    expect(commands["all-status"]?.template).toMatch(/do NOT write|read-only|read only/);
  });
});

describe("/all-* commands bypass the atlas deterministic hook", () => {
  it("shouldSkipAtlasCommandHook returns false for /all-init (no interception)", () => {
    expect(shouldSkipAtlasCommandHook("all-init")).toBe(false);
  });

  it("shouldSkipAtlasCommandHook returns false for /all-rebuild", () => {
    expect(shouldSkipAtlasCommandHook("all-rebuild")).toBe(false);
  });

  it("shouldSkipAtlasCommandHook returns false for /all-status", () => {
    expect(shouldSkipAtlasCommandHook("all-status")).toBe(false);
  });

  it("the atlas hook does not match all-* commands", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const ctx = createCtx(tempRoot);
    const plugin = await OpenCodeConfigPlugin(ctx);

    const input = { command: "all-init", sessionID: "test-session", arguments: "" };
    const output = { parts: [] as unknown[] };

    const hook = plugin["command.execute.before"] as ((...args: never) => unknown) | undefined;
    await hook?.(input as never, output as never);

    // The atlas hook only handles atlas-init, atlas-status, atlas-refresh, atlas-translate.
    // For all-init it should NOT append a part.
    expect(output.parts).toHaveLength(0);
  });
});
