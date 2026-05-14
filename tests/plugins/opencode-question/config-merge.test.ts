import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin as plugin } from "../../../src/index";
import { stopSharedServer } from "../../../src/octto/session/server";

const PREFIX = "micode-question-config-merge-";

type PermissionRule = "allow" | "ask" | "deny";
type PermissionValue = PermissionRule | Record<string, PermissionRule>;

interface FakeOpencodeConfig {
  permission?: Record<string, PermissionValue>;
  agent?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  command?: Record<string, unknown>;
  tools?: Record<string, unknown>;
}

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

async function runConfigHook(initial: FakeOpencodeConfig): Promise<{
  config: FakeOpencodeConfig;
  hooks: Awaited<ReturnType<typeof plugin>>;
}> {
  tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
  const hooks = await plugin(createCtx(tempRoot));
  if (!hooks.config) throw new Error("plugin did not register a config hook");
  await hooks.config(initial as Parameters<NonNullable<typeof hooks.config>>[0]);
  return { config: initial, hooks };
}

afterEach(async () => {
  await stopSharedServer();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("micode plugin config hook: question permission wiring", () => {
  it("sets question: 'allow' when input config has no permission map", async () => {
    const { config } = await runConfigHook({});

    expect(config.permission?.question).toBe("allow");
  });

  it("sets question: 'allow' when permission lacks question and preserves read", async () => {
    const { config } = await runConfigHook({ permission: { read: "allow" } });

    expect(config.permission?.question).toBe("allow");
    expect(config.permission?.read).toBe("allow");
  });

  it("preserves user-supplied question: 'deny'", async () => {
    const { config } = await runConfigHook({ permission: { question: "deny" } });

    expect(config.permission?.question).toBe("deny");
  });

  it("preserves user-supplied question pattern-map", async () => {
    const patternRules = { "secret-*": "deny", "*": "allow" } as const;
    const { config } = await runConfigHook({ permission: { question: patternRules } });

    expect(config.permission?.question).toEqual(patternRules);
  });

  it("keeps existing edit/bash/webfetch/external_directory allow rules", async () => {
    const { config } = await runConfigHook({ permission: {} });

    expect(config.permission?.edit).toBe("allow");
    expect(config.permission?.bash).toBe("allow");
    expect(config.permission?.webfetch).toBe("allow");
    expect(config.permission?.external_directory).toBe("allow");
  });

  it("does not add a question key to returned hooks.tools", async () => {
    const { hooks } = await runConfigHook({ permission: {} });

    expect(Object.hasOwn(hooks.tools ?? {}, "question")).toBe(false);
  });
});
