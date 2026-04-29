import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const SESSION_ID = "session_1";
const DIRECTORY = "/tmp/repo";
const AGENT = "codebase-analyzer";
const PROMPT = "inspect the code";
const DESCRIPTION = "Inspect code";
const TASK_ERROR_OUTPUT = "TEST FAILED: keep this session resumable";
const SUCCESS_OUTPUT = "all done";
const MAX_RESUMES = 2;
const TTL_HOURS = 1;
const TASK = { agent: AGENT, prompt: PROMPT, description: DESCRIPTION } as const;

interface CreateRequest {
  readonly body: { readonly title?: string };
  readonly query: { readonly directory: string };
}

const createRegistry = () => createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });

function createCtx(output: string, deleteSession: ReturnType<typeof mock>): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: output }],
      },
    ],
  }));

  return {
    client: { session: { create, prompt, messages, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}

describe("spawn-agent tool internal sessions", () => {
  it("creates production sessions with spawn-agent titles and retries delete on success", async () => {
    let deleteAttempts = 0;
    const deleteSession = mock(async () => {
      deleteAttempts += 1;
      if (deleteAttempts === 1) throw new Error("temporary delete failure");
      return {};
    });
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    const createCall = ctx.client.session.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(createCall?.body.title).toBe("spawn-agent.codebase-analyzer");
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(0);
  });

  it("preserves task_error sessions instead of deleting them", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(TASK_ERROR_OUTPUT, deleteSession);
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SESSION_ID);
    expect(deleteSession).not.toHaveBeenCalled();
    expect(registry.get(SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      agent: AGENT,
      description: DESCRIPTION,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });
  });
});
