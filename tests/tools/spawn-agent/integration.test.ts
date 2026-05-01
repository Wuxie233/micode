import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { classifySpawnError, INTERNAL_CLASSES } from "@/tools/spawn-agent/classify";
import { cleanupGeneration } from "@/tools/spawn-agent/cleanup";
import { createSpawnSessionRegistry } from "@/tools/spawn-agent/spawn-session-registry";
import { createSpawnAgentTool } from "../../../src/tools/spawn-agent";
import { createPreservedRegistry } from "../../../src/tools/spawn-agent/registry";
import { SPAWN_OUTCOMES } from "../../../src/tools/spawn-agent/types";

const SUCCESS_TASK = {
  agent: "implementer-general",
  prompt: "finish the implementation",
  description: "Successful task",
};

const BLOCKED_TASK = {
  agent: "implementer-backend",
  prompt: "check the contract",
  description: "Blocked task",
};

const TASK_ERROR_TASK = {
  agent: "implementer-frontend",
  prompt: "run the tests",
  description: "Task error task",
};

const HARD_FAILURE_TASK = {
  agent: "reviewer",
  prompt: "raise a hard failure",
  description: "Hard failure task",
};

const MAX_RESUMES = 3;
const TTL_HOURS = 1;
const CLEANUP_TTL_HOURS = 24;
const RUNNING_TTL_MS = 60_000;
const HARD_FAILURE_SESSION = "session-hard-failure";
const HARD_FAILURE_MESSAGE = "Spawned session exploded";

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

const createCtx = (): PluginInput =>
  ({
    directory: "/tmp/spawn-agent-integration-test",
    client: { session: { delete: mock(async () => ({})) } },
  }) as unknown as PluginInput;

const callExecute = async (toolDef: ReturnType<typeof createSpawnAgentTool>, args: unknown): Promise<string> => {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, {});
};

describe("spawn_agent integration", () => {
  it("preserves resumable sessions and formats structured parallel results", async () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const toolDef = createSpawnAgentTool(createCtx(), {
      registry,
      executeAgentSession: async (_ctx, task) => {
        if (task.agent === HARD_FAILURE_TASK.agent) {
          throw Object.assign(new Error(HARD_FAILURE_MESSAGE), { sessionId: HARD_FAILURE_SESSION });
        }
        if (task.agent === BLOCKED_TASK.agent) {
          return { sessionId: "session-blocked", output: "BLOCKED: contract mismatch" };
        }
        if (task.agent === TASK_ERROR_TASK.agent) {
          return { sessionId: "session-task-error", output: "TEST FAILED: unit test rejected the change" };
        }
        return { sessionId: "session-success", output: "Completed successfully." };
      },
    });

    const output = await callExecute(toolDef, {
      agents: [SUCCESS_TASK, TASK_ERROR_TASK, BLOCKED_TASK, HARD_FAILURE_TASK],
    });
    const preserved = registry.get("session-blocked");
    const taskError = registry.get("session-task-error");

    expect(output).toContain("| Successful task | implementer-general | success |");
    expect(output).toContain("| Task error task | implementer-frontend | task_error |");
    expect(output).toContain("| Blocked task | implementer-backend | blocked |");
    expect(output).toContain("| Hard failure task | reviewer | hard_failure |");
    expect(output).toContain("| - | Spawned session exploded |");
    expect(output).toContain("**SessionID**: session-task-error");
    expect(output).toContain("**SessionID**: session-blocked");
    expect(taskError).toMatchObject({
      sessionId: "session-task-error",
      agent: TASK_ERROR_TASK.agent,
      description: TASK_ERROR_TASK.description,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });
    expect(preserved).toMatchObject({
      sessionId: "session-blocked",
      agent: BLOCKED_TASK.agent,
      description: BLOCKED_TASK.description,
      outcome: SPAWN_OUTCOMES.BLOCKED,
      resumeCount: 0,
    });
    expect(registry.get("session-success")).toBeNull();
    expect(registry.get(HARD_FAILURE_SESSION)).toBeNull();
  });
});

describe("verifier disabled fallback", () => {
  it("classifier still returns needs_verification when marker is narrative", () => {
    const result = classifySpawnError({
      assistantText: "All passed. Reviewer would say 'TEST FAILED' if it broke.",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
  });
});

describe("cleanup does not corrupt unrelated successful results", () => {
  it("delete failure is logged but does not throw", async () => {
    const registry = createSpawnSessionRegistry({
      maxResumes: MAX_RESUMES,
      ttlHours: CLEANUP_TTL_HOURS,
      runningTtlMs: RUNNING_TTL_MS,
    });
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      taskIdentity: "t",
    });
    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          delete: async () => {
            throw new Error("simulated");
          },
        },
      },
    } as unknown as Parameters<typeof cleanupGeneration>[0]["ctx"];

    const result = await cleanupGeneration({
      ctx,
      registry,
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      reason: "test",
    });

    expect(result.aborted).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failures.length).toBe(1);
  });
});
