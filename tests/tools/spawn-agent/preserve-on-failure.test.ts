import { describe, expect, it, mock } from "bun:test";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";

interface FakeClient {
  readonly session: {
    readonly delete: ReturnType<typeof mock>;
  };
}

const TASK_ERROR_OUTPUT = "TEST FAILED: needs human input";
const BLOCKED_OUTPUT = "BLOCKED: dependency mismatch";
const TASK_ERROR_SESSION = "preserved_1";
const BLOCKED_SESSION = "blocked_1";
const SUCCESS_SESSION = "ok_1";
const AGENT = "x";
const PROMPT = "p";
const DESCRIPTION = "d";
const MAX_RESUMES = 2;
const TTL_HOURS = 1;
const TASK = { agent: AGENT, prompt: PROMPT, description: DESCRIPTION } as const;

const createCtx = (client: FakeClient) =>
  ({
    client,
    directory: "/tmp/repo",
  }) as never;

const createRegistry = () => createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });

describe("spawn-agent deletes task_error/blocked sessions", () => {
  it("deletes the session when outcome is task_error", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { delete: del } };
    const ctx = createCtx(client);
    const registry = createRegistry();

    const executeAgentSession = mock(async () => ({ sessionId: TASK_ERROR_SESSION, output: TASK_ERROR_OUTPUT }));

    const tool = createSpawnAgentTool(ctx, { registry, executeAgentSession });
    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(TASK_ERROR_OUTPUT);
    expect(output).not.toContain(TASK_ERROR_SESSION);
    expect(output).not.toContain("SessionID");
    expect(del).toHaveBeenCalled();
    expect(registry.get(TASK_ERROR_SESSION)).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it("deletes the session when outcome is blocked", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { delete: del } };
    const ctx = createCtx(client);
    const registry = createRegistry();

    const executeAgentSession = mock(async () => ({ sessionId: BLOCKED_SESSION, output: BLOCKED_OUTPUT }));

    const tool = createSpawnAgentTool(ctx, { registry, executeAgentSession });
    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(BLOCKED_OUTPUT);
    expect(output).not.toContain(BLOCKED_SESSION);
    expect(output).not.toContain("SessionID");
    expect(del).toHaveBeenCalled();
    expect(registry.get(BLOCKED_SESSION)).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it("deletes the session on success", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { delete: del } };
    const ctx = createCtx(client);
    const registry = createRegistry();

    const executeAgentSession = mock(async () => ({ sessionId: SUCCESS_SESSION, output: "done" }));
    const tool = createSpawnAgentTool(ctx, { registry, executeAgentSession });
    await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(del).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });
});
