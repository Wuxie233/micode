import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";

const SESSION_ID = "session_int";
const DIRECTORY = "/tmp/repo";
const BLOCKED_OUTPUT = "BLOCKED: waiting for clarification on API contract";
const SUCCESS_OUTPUT = "完成";
const REGISTRY_OPTS = { maxResumes: 2, ttlHours: 1 } as const;

interface CreateRequest {
  readonly body: { readonly title?: string };
}

interface UpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title?: string };
}

function createCtx(assistantOutput: string) {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: assistantOutput }],
      },
    ],
  }));
  const update = mock(async () => ({}));
  const del = mock(async () => ({}));
  const ctx = {
    client: { session: { create, prompt, messages, delete: del, update } },
    directory: DIRECTORY,
  } as never as PluginInput;
  return { ctx, create, update, delete: del };
}

describe("spawn-agent naming integration", () => {
  it("success path: session is created with 执行中 title, then deleted (no terminal-title write)", async () => {
    const stubs = createCtx(SUCCESS_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [
          {
            agent: "implementer-backend",
            prompt: "implement endpoint",
            description: "新增登录接口",
          },
        ],
      },
      { metadata: () => {} } as never,
    );

    const createCall = stubs.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 新增登录接口");

    expect(stubs.delete).toHaveBeenCalledTimes(1);
    expect(stubs.update).not.toHaveBeenCalled();
  });

  it("blocked path: session is preserved and title is updated to 阻塞", async () => {
    const stubs = createCtx(BLOCKED_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [
          {
            agent: "reviewer",
            prompt: "review the PR",
            description: "审查 PR #42",
          },
        ],
      },
      { metadata: () => {} } as never,
    );

    expect(stubs.delete).not.toHaveBeenCalled();
    expect(stubs.update).toHaveBeenCalledTimes(1);

    const updateCall = stubs.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.path.id).toBe(SESSION_ID);
    expect(updateCall?.body.title).toBe("阻塞: 审查 PR #42");
    expect(registry.get(SESSION_ID)).not.toBeNull();
  });

  it("missing description falls back to Chinese role label across the full pipeline", async () => {
    const stubs = createCtx(SUCCESS_OUTPUT);
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [{ agent: "implementer-frontend", prompt: "tweak ui", description: "" }],
      },
      { metadata: () => {} } as never,
    );

    const createCall = stubs.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 前端实现");
  });
});
