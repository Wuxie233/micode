// Tests that /atlas-init routes to the atlas-initializer agent and that the
// command.execute.before hook does NOT run runAtlasInit directly for atlas-init.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "../src/index";
import { stopSharedServer } from "../src/octto/session/server";
import * as atlasInitModule from "../src/tools/atlas/init";

const PREFIX = "micode-atlas-init-routing-";

let tempRoot: string | undefined;

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

afterEach(async () => {
  await stopSharedServer();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("/atlas-init command routing", () => {
  it("registers atlas-init command with agent=atlas-initializer (not primary agent)", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const ctx = createCtx(tempRoot);
    const plugin = await OpenCodeConfigPlugin(ctx);

    // Capture what config.command gets set to. The handler does config.command = { ...merged },
    // so we must read back from the same config object reference, not a separate variable.
    const configObj: Parameters<NonNullable<typeof plugin.config>>[0] = {
      permission: {},
      agent: {},
      mcp: {},
      command: {},
    } as Parameters<NonNullable<typeof plugin.config>>[0];
    await plugin.config?.(configObj);

    const atlasInitCommand = configObj.command?.["atlas-init"] as { agent?: string } | undefined;
    expect(atlasInitCommand).toBeDefined();
    expect(atlasInitCommand?.agent).toBe("atlas-initializer");
  });

  it("command.execute.before does NOT call runAtlasInit for atlas-init", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const ctx = createCtx(tempRoot);
    const plugin = await OpenCodeConfigPlugin(ctx);

    const spy = spyOn(atlasInitModule, "runAtlasInit");

    const input = {
      command: "atlas-init",
      sessionID: "test-session",
      arguments: "",
    };
    const output = { parts: [] as unknown[] };

    // Should return without calling runAtlasInit
    const hook = plugin["command.execute.before"] as ((...args: never) => unknown) | undefined;
    await hook?.(input as never, output as never);

    expect(spy).not.toHaveBeenCalled();
    // No parts should have been appended
    expect(output.parts).toHaveLength(0);
  });

  it("command.execute.before still executes atlas-status directly", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const ctx = createCtx(tempRoot);
    const plugin = await OpenCodeConfigPlugin(ctx);

    const input = {
      command: "atlas-status",
      sessionID: "test-session",
      arguments: "",
    };
    const output = { parts: [] as unknown[] };

    // Should execute atlas-status (it will fail or succeed based on vault presence,
    // but it should NOT skip like atlas-init does: parts will be appended)
    const hook = plugin["command.execute.before"] as ((...args: never) => unknown) | undefined;
    await hook?.(input as never, output as never);

    // atlas-status appends a result part
    expect(output.parts).toHaveLength(1);
  });
});
