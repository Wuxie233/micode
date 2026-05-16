import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createResumeSubagentTool } from "../../src/tools/resume-subagent";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent";
import { createPreservedRegistry } from "../../src/tools/spawn-agent/registry";

const SUCCESS_TASK = {
  agent: "implementer-general",
  prompt: "finish the implementation",
  description: "Successful task",
};

const TASK_ERROR_TASK = {
  agent: "implementer-frontend-ui",
  prompt: "run the focused test",
  description: "Task error task",
};

const HARD_FAILURE_TASK = {
  agent: "reviewer",
  prompt: "raise a hard failure",
  description: "Hard failure task",
};

const MAX_RESUMES = 3;
const TTL_HOURS = 1;
const SUCCESS_SESSION = "session-success";
const TASK_ERROR_SESSION = "session-task-error";
const HARD_FAILURE_SESSION = "session-hard-failure";
const SPAWN_SUCCESS_OUTPUT = "Spawn completed successfully.";
const TASK_ERROR_OUTPUT = "TEST FAILED: focused integration test rejected the change.";
const HARD_FAILURE_MESSAGE = "Spawned session crashed.";
const RESUME_SUCCESS_OUTPUT = "Resume completed successfully.";
const CONTEXT_CAPSULE_CONTENT = `---
lifecycle_issue: 91
---

## Confirmed Facts

- Capsule state should be launch-only.
`;
const CONTEXT_CAPSULE_TASK = {
  ...TASK_ERROR_TASK,
  prompt: "run the focused test with a capsule",
  description: "Capsuled task error",
  contextCapsule: {
    path: "thoughts/shared/context-capsules/issue-91-working-context.md",
    sha: "capsule-sha-allsettled",
    token: "capsule-token-allsettled",
    content: CONTEXT_CAPSULE_CONTENT,
  },
};

interface PromptCall {
  readonly id: string;
  readonly text: string;
}

interface Recorder {
  readonly promptCalls: PromptCall[];
  readonly deleteCalls: string[];
}

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

function createCtx(recorder: Recorder): PluginInput {
  const session = {
    prompt: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly parts: readonly { readonly text: string }[] };
    }) => {
      recorder.promptCalls.push({
        id: input.path.id,
        text: input.body.parts[0]?.text ?? "",
      });
    },
    messages: async () => ({
      data: [
        {
          info: { role: "assistant" as const },
          parts: [{ type: "text", text: RESUME_SUCCESS_OUTPUT }],
        },
      ],
    }),
    delete: async (input: { readonly path: { readonly id: string } }) => {
      recorder.deleteCalls.push(input.path.id);
    },
  };

  return {
    directory: "/tmp/spawn-agent-allsettled-test",
    client: { session },
  } as unknown as PluginInput;
}

async function callSpawnExecute(toolDef: ReturnType<typeof createSpawnAgentTool>, args: unknown): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, {});
}

async function callResumeExecute(toolDef: ReturnType<typeof createResumeSubagentTool>, args: unknown): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, {});
}

describe("spawn_agent allSettled integration", () => {
  it("deletes task_error sessions and rejects resume", async () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const recorder: Recorder = { promptCalls: [], deleteCalls: [] };
    const ctx = createCtx(recorder);
    const spawnTool = createSpawnAgentTool(ctx, {
      registry,
      executeAgentSession: async (_ctx, task) => {
        if (task.agent === TASK_ERROR_TASK.agent) return { sessionId: TASK_ERROR_SESSION, output: TASK_ERROR_OUTPUT };
        if (task.agent === HARD_FAILURE_TASK.agent) {
          throw Object.assign(new Error(HARD_FAILURE_MESSAGE), { sessionId: HARD_FAILURE_SESSION });
        }
        return { sessionId: SUCCESS_SESSION, output: SPAWN_SUCCESS_OUTPUT };
      },
    });

    const spawnOutput = await callSpawnExecute(spawnTool, {
      agents: [SUCCESS_TASK, TASK_ERROR_TASK, HARD_FAILURE_TASK],
    });

    expect(spawnOutput).toContain("| Successful task | implementer-general | success |");
    expect(spawnOutput).toContain("| Task error task | implementer-frontend-ui | task_error |");
    expect(spawnOutput).toContain("| Hard failure task | reviewer | hard_failure |");
    expect(spawnOutput).not.toContain("SessionID");
    expect(registry.size()).toBe(0);
    expect(registry.get(TASK_ERROR_SESSION)).toBeNull();
    expect(registry.get(SUCCESS_SESSION)).toBeNull();
    expect(recorder.deleteCalls).toContain(SUCCESS_SESSION);
    expect(recorder.deleteCalls).toContain(TASK_ERROR_SESSION);

    const resumeTool = createResumeSubagentTool(ctx, { registry });
    const resumeOutput = await callResumeExecute(resumeTool, { session_id: TASK_ERROR_SESSION });

    expect(resumeOutput).toContain("**Outcome**: hard_failure");
    expect(resumeOutput).toContain("**SessionID**: -");
    expect(resumeOutput).toContain("Session not preserved or expired.");
    expect(registry.size()).toBe(0);

    const secondSpawnOutput = await callSpawnExecute(spawnTool, { agents: [TASK_ERROR_TASK] });

    expect(secondSpawnOutput).toContain("**Outcome**: task_error");
    expect(secondSpawnOutput).not.toContain("Generation fence");
    expect(secondSpawnOutput).not.toContain("SessionID");
    expect(registry.get(TASK_ERROR_SESSION)).toBeNull();
  });

  it("does not preserve task_error sessions or capsule state when contextCapsule is present", async () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const recorder: Recorder = { promptCalls: [], deleteCalls: [] };
    const ctx = createCtx(recorder);
    const seenCapsules: unknown[] = [];
    const spawnTool = createSpawnAgentTool(ctx, {
      registry,
      executeAgentSession: async (_ctx, task) => {
        seenCapsules.push(task.contextCapsule);
        return { sessionId: TASK_ERROR_SESSION, output: TASK_ERROR_OUTPUT };
      },
    });

    const spawnOutput = await callSpawnExecute(spawnTool, { agents: [CONTEXT_CAPSULE_TASK] });

    expect(spawnOutput).toContain("**Outcome**: task_error");
    expect(spawnOutput).not.toContain("SessionID");
    expect(seenCapsules).toEqual([CONTEXT_CAPSULE_TASK.contextCapsule]);
    expect(registry.size()).toBe(0);
    expect(registry.get(TASK_ERROR_SESSION)).toBeNull();
    expect(recorder.deleteCalls).toContain(TASK_ERROR_SESSION);

    const resumeTool = createResumeSubagentTool(ctx, { registry });
    const resumeOutput = await callResumeExecute(resumeTool, { session_id: TASK_ERROR_SESSION });

    expect(resumeOutput).toContain("**Outcome**: hard_failure");
    expect(resumeOutput).toContain("**SessionID**: -");
    expect(resumeOutput).toContain("Session not preserved or expired.");
    expect(resumeOutput).not.toContain("contextCapsule");
    expect(resumeOutput).not.toContain("<context-capsule");
    expect(resumeOutput).not.toContain(CONTEXT_CAPSULE_TASK.contextCapsule.token);
    expect(resumeOutput).not.toContain(CONTEXT_CAPSULE_TASK.contextCapsule.sha);
    expect(resumeOutput).not.toContain("Capsule state should be launch-only.");
    expect(registry.size()).toBe(0);
  });
});
