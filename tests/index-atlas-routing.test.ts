import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin, shouldSkipAtlasCommandHook } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const PREFIX = "micode-atlas-routing-";
const ATLAS_TRANSLATE_COMMAND = "atlas-translate";
const ATLAS_TRANSLATOR_AGENT = "atlas-translator";
const ATLAS_INIT_COMMAND = "atlas-init";
const ATLAS_STATUS_COMMAND = "atlas-status";
const ATLAS_REFRESH_COMMAND = "atlas-refresh";

let tempRoot: string | undefined;

interface CommandConfig {
  readonly agent?: string;
  readonly template?: string;
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
      tui: {
        showToast: async () => undefined,
      },
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

describe("atlas command routing", () => {
  it("routes atlas-translate to the atlas translator agent", async () => {
    const commands = await loadCommands();
    const command = commands[ATLAS_TRANSLATE_COMMAND];

    expect(command).toBeDefined();
    expect(command?.agent).toBe(ATLAS_TRANSLATOR_AGENT);
    expect(command?.template).toBe("Run the /atlas-translate Project Atlas command with arguments: $ARGUMENTS");
  });

  it("skips deterministic atlas hook execution for agent-routed commands", () => {
    expect(shouldSkipAtlasCommandHook(ATLAS_INIT_COMMAND)).toBe(true);
    expect(shouldSkipAtlasCommandHook(ATLAS_TRANSLATE_COMMAND)).toBe(true);
    expect(shouldSkipAtlasCommandHook(ATLAS_STATUS_COMMAND)).toBe(false);
    expect(shouldSkipAtlasCommandHook(ATLAS_REFRESH_COMMAND)).toBe(false);
  });
});
