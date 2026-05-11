import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const PREFIX = "micode-knowledge-bootstrap-commands-";

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

describe("knowledge bootstrap commands registration", () => {
  it("registers /all-init routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-init"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("missing-only");
  });

  it("registers /all-rebuild routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-rebuild"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("refresh-all");
  });

  it("registers /all-status routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-status"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("status-only");
  });

  it("preserves the existing /init, /mindmodel, /atlas-init commands", async () => {
    const commands = await loadCommands();
    expect(commands.init?.agent).toBe("project-initializer");
    expect(commands.mindmodel?.agent).toBe("mm-orchestrator");
    expect(commands["atlas-init"]?.agent).toBe("atlas-initializer");
  });

  it("commands have non-empty descriptions naming bootstrap intent", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.description?.toLowerCase()).toContain("bootstrap");
    expect(commands["all-rebuild"]?.description?.toLowerCase()).toContain("rebuild");
    expect(commands["all-status"]?.description?.toLowerCase()).toContain("status");
  });
});

describe("plugin tool wiring: detect_knowledge_state", () => {
  it("exposes detect_knowledge_state in plugin tool record", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
    expect(plugin.tool).toBeDefined();
    expect((plugin.tool as Record<string, unknown>).detect_knowledge_state).toBeDefined();
  });
});
