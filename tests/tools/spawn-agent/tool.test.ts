import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnSessionRegistry } from "@/tools/spawn-agent/spawn-session-registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";
import { VERIFIER_CONFIDENCE, VERIFIER_DECISIONS } from "@/tools/spawn-agent/verifier-types";

const SESSION_ID = "session_1";
const DIRECTORY = "/tmp/repo";
const AGENT = "codebase-analyzer";
const PROMPT = "inspect the code";
const DESCRIPTION = "Inspect code";
const TASK_ERROR_OUTPUT = "TEST FAILED keep this session resumable";
const SUCCESS_OUTPUT = "all done";
const NARRATIVE_OUTPUT = "The string TEST FAILED appears in docs, but the task completed.";
const NARRATIVE_MARKER_OUTPUT = "All passed. Reviewer would print 'TEST FAILED' if anything broke.";
const FINAL_MARKER_OUTPUT = "Logs:\nTEST FAILED\n";
const HARD_FAILURE_MESSAGE = "provider rejected session";
const PARENT_SESSION_ID = "parent-session";
const CONFLICT_SESSION_ID = "session_conflict";
const RUN_ID = "executor-issue-18";
const TASK_ID = "task-3.1";
const MAX_RESUMES = 2;
const TTL_HOURS = 1;
const TASK = { agent: AGENT, prompt: PROMPT, description: DESCRIPTION } as const;
const EXPLICIT_TASK = {
  agent: AGENT,
  prompt: `<spawn-meta task-id="${TASK_ID}" run-id="${RUN_ID}" generation="2" />\n${PROMPT}`,
  description: DESCRIPTION,
} as const;

interface CreateRequest {
  readonly body: { readonly title?: string };
  readonly query: { readonly directory: string };
}

interface UpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title?: string };
  readonly query: { readonly directory: string };
}

interface DeleteRequest {
  readonly path: { readonly id: string };
  readonly query: { readonly directory: string };
}

const createRegistry = () => createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
const createSpawnRegistry = () =>
  createSpawnSessionRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS, runningTtlMs: 60_000 });

function createSessionError(message: string, sessionId: string): Error & { readonly sessionId: string } {
  return Object.assign(new Error(message), { sessionId });
}

function createCtx(output: string, deleteSession: ReturnType<typeof mock>): PluginInput {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const update = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: output }],
      },
    ],
  }));

  return {
    client: { session: { create, prompt, messages, update, delete: deleteSession } },
    directory: DIRECTORY,
  } as never;
}

describe("spawn-agent tool internal sessions", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("creates production sessions with running titles and retries delete on success", async () => {
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
    expect(createCall?.body.title).toBe("执行中: Inspect code");
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(ctx.client.session.update.mock.calls).toHaveLength(0);
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
    const updateCall = ctx.client.session.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.path.id).toBe(SESSION_ID);
    expect(updateCall?.body.title).toBe("失败: Inspect code");
    expect(registry.get(SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      agent: AGENT,
      description: DESCRIPTION,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });
  });

  it("blocks duplicate generations before creating a session", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const runSession = mock(async () => ({ sessionId: SESSION_ID, output: SUCCESS_OUTPUT }));

    spawnRegistry.registerRunning({
      sessionId: CONFLICT_SESSION_ID,
      agent: AGENT,
      description: DESCRIPTION,
      ownerSessionId: PARENT_SESSION_ID,
      runId: RUN_ID,
      generation: 1,
      taskIdentity: TASK_ID,
    });

    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, executeAgentSession: runSession });

    const output = await tool.execute({ agents: [EXPLICIT_TASK] }, {
      metadata: () => {},
      sessionID: PARENT_SESSION_ID,
    } as never);

    expect(output).toContain(SPAWN_OUTCOMES.BLOCKED);
    expect(output).toContain("Generation fence");
    expect(output).toContain(CONFLICT_SESSION_ID);
    expect(output).toContain("fence=duplicate_running");
    expect(runSession).not.toHaveBeenCalled();
    expect(ctx.client.session.create.mock.calls).toHaveLength(0);
  });

  it("does not preserve a session whose marker is narrative and verifier says narrative", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const verifier = mock(async () => ({
      decision: VERIFIER_DECISIONS.NARRATIVE,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "narrative",
    }));
    const runSession = mock(async () => ({ sessionId: SESSION_ID, output: NARRATIVE_MARKER_OUTPUT }));
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, verifier, executeAgentSession: runSession });

    const output = await tool.execute({ agents: [EXPLICIT_TASK] }, {
      metadata: () => {},
      sessionID: PARENT_SESSION_ID,
    } as never);

    expect(output).toContain(NARRATIVE_MARKER_OUTPUT);
    expect(output).toContain("verifier=narrative");
    expect(output).not.toContain("Resume count");
    expect(deleteSession).toHaveBeenCalled();
    expect(registry.size()).toBe(0);
    expect(spawnRegistry.listPreserved()).toHaveLength(0);
  });

  it("preserves a session when marker is final without verifier consultation", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const verifier = mock(async () => ({
      decision: VERIFIER_DECISIONS.NARRATIVE,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "would be ignored for final markers",
    }));
    const runSession = mock(async () => ({ sessionId: SESSION_ID, output: FINAL_MARKER_OUTPUT }));
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, verifier, executeAgentSession: runSession });

    const output = await tool.execute({ agents: [EXPLICIT_TASK] }, {
      metadata: () => {},
      sessionID: PARENT_SESSION_ID,
    } as never);

    expect(output).toContain(SPAWN_OUTCOMES.TASK_ERROR);
    expect(output).toContain(FINAL_MARKER_OUTPUT);
    expect(verifier).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
    expect(spawnRegistry.listPreserved()).toHaveLength(1);
  });

  it("uses verifier narrative verdicts to clean up ambiguous marker sessions", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(NARRATIVE_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const verifier = mock(async () => ({
      decision: VERIFIER_DECISIONS.NARRATIVE,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "marker is quoted as documentation",
    }));
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, verifier });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(NARRATIVE_OUTPUT);
    expect(output).toContain("verifier=narrative");
    expect(deleteSession).toHaveBeenCalled();
    expect(ctx.client.session.update.mock.calls).toHaveLength(0);
    expect(registry.size()).toBe(0);
    expect(spawnRegistry.size()).toBe(0);
  });

  it("uses verifier final verdicts to preserve ambiguous marker sessions", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(NARRATIVE_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const verifier = mock(async () => ({
      decision: VERIFIER_DECISIONS.FINAL,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "marker is the final status",
    }));
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, verifier });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SPAWN_OUTCOMES.TASK_ERROR);
    expect(output).toContain("verifier=final");
    expect(deleteSession).not.toHaveBeenCalled();
    const updateCall = ctx.client.session.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.body.title).toBe("失败: Inspect code");
    expect(spawnRegistry.get(SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });
  });

  it("falls back to success and cleanup when verifier returns null", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(NARRATIVE_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const verifier = mock(async () => null);
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, verifier });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(NARRATIVE_OUTPUT);
    expect(output).toContain("verifier=fallback");
    expect(verifier).toHaveBeenCalledTimes(1);
    const deleteCall = deleteSession.mock.calls[0]?.[0] as DeleteRequest | undefined;
    expect(deleteCall?.path.id).toBe(SESSION_ID);
    expect(ctx.client.session.update.mock.calls).toHaveLength(0);
    expect(registry.size()).toBe(0);
    expect(spawnRegistry.size()).toBe(0);
  });

  it("cleans up hard failures with session ids instead of preserving them", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const spawnRegistry = createSpawnRegistry();
    const runSession = mock(async () => {
      throw createSessionError(HARD_FAILURE_MESSAGE, SESSION_ID);
    });
    const tool = createSpawnAgentTool(ctx, { registry, spawnRegistry, executeAgentSession: runSession });

    const output = await tool.execute({ agents: [TASK] }, { metadata: () => {} } as never);

    expect(output).toContain(SPAWN_OUTCOMES.HARD_FAILURE);
    expect(output).toContain(HARD_FAILURE_MESSAGE);
    const deleteCall = deleteSession.mock.calls[0]?.[0] as DeleteRequest | undefined;
    expect(deleteCall?.path.id).toBe(SESSION_ID);
    expect(ctx.client.session.update.mock.calls).toHaveLength(0);
    expect(registry.size()).toBe(0);
    expect(spawnRegistry.size()).toBe(0);
  });

  it("uses the Chinese reviewer fallback for empty descriptions", async () => {
    const deleteSession = mock(async () => ({}));
    const ctx = createCtx(SUCCESS_OUTPUT, deleteSession);
    const registry = createRegistry();
    const tool = createSpawnAgentTool(ctx, { registry });

    await tool.execute({ agents: [{ agent: "reviewer", prompt: PROMPT, description: "" }] }, {
      metadata: () => {},
    } as never);

    const createCall = ctx.client.session.create.mock.calls[0]?.[0] as CreateRequest | undefined;
    expect(createCall?.body.title).toBe("执行中: 代码审查");
  });
});
