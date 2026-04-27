import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createResumeSubagentTool } from "../../src/tools/resume-subagent";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent";
import { createPreservedRegistry } from "../../src/tools/spawn-agent/registry";
import { SPAWN_OUTCOMES } from "../../src/tools/spawn-agent/types";

const SUCCESS_TASK = {
  agent: "implementer-general",
  prompt: "finish the implementation",
  description: "Successful task",
};

const TASK_ERROR_TASK = {
  agent: "implementer-frontend",
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
  it("preserves task_error sessions and resumes them to success", async () => {
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
    expect(spawnOutput).toContain("| Task error task | implementer-frontend | task_error |");
    expect(spawnOutput).toContain("| Hard failure task | reviewer | hard_failure |");
    expect(registry.size()).toBe(1);
    expect(registry.get(TASK_ERROR_SESSION)).toMatchObject({
      sessionId: TASK_ERROR_SESSION,
      agent: TASK_ERROR_TASK.agent,
      description: TASK_ERROR_TASK.description,
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      resumeCount: 0,
    });
    expect(registry.get(SUCCESS_SESSION)).toBeNull();
    expect(recorder.deleteCalls).toContain(SUCCESS_SESSION);

    const resumeTool = createResumeSubagentTool(ctx, { registry });
    const resumeOutput = await callResumeExecute(resumeTool, { session_id: TASK_ERROR_SESSION });

    expect(resumeOutput).toContain("**Outcome**: success");
    expect(resumeOutput).toContain(`**SessionID**: ${TASK_ERROR_SESSION}`);
    expect(resumeOutput).toContain("**Resume count**: 1");
    expect(resumeOutput).toContain(RESUME_SUCCESS_OUTPUT);
    expect(recorder.deleteCalls).toContain(TASK_ERROR_SESSION);
    expect(registry.size()).toBe(0);
  });
});
