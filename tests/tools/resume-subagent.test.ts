import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createResumeSubagentTool } from "../../src/tools/resume-subagent";
import { createPreservedRegistry } from "../../src/tools/spawn-agent/registry";
import { buildSubagentResumePrompt } from "../../src/tools/spawn-agent/resume-prompt";
import { SPAWN_OUTCOMES } from "../../src/tools/spawn-agent/types";
import { config } from "../../src/utils/config";

const SESSION_ID = "session-resume";
const AGENT = "implementer-general";
const DESCRIPTION = "Resume preserved task";
const TTL_HOURS = 1;
const SUCCESS_OUTPUT = "Implementation completed successfully.";
const TRANSIENT_MESSAGE = "fetch failed";

interface PromptCall {
  readonly id: string;
  readonly text: string;
}

interface FakeRecorder {
  readonly promptCalls: PromptCall[];
  readonly deleteCalls: string[];
}

interface FakeOptions {
  readonly assistantText?: string;
  readonly promptError?: Error;
}

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

function createRegistry() {
  return createPreservedRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: TTL_HOURS,
  });
}

function preserveSession(registry: ReturnType<typeof createRegistry>): void {
  registry.preserve({
    sessionId: SESSION_ID,
    agent: AGENT,
    description: DESCRIPTION,
    outcome: SPAWN_OUTCOMES.TASK_ERROR,
  });
}

function buildSession(recorder: FakeRecorder, options: FakeOptions) {
  return {
    prompt: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly parts: readonly { readonly text: string }[] };
    }) => {
      if (options.promptError) throw options.promptError;
      recorder.promptCalls.push({
        id: input.path.id,
        text: input.body.parts[0]?.text ?? "",
      });
    },
    messages: async () => ({
      data: [
        {
          info: { role: "assistant" as const },
          parts: [{ type: "text", text: options.assistantText ?? SUCCESS_OUTPUT }],
        },
      ],
    }),
    delete: async (input: { readonly path: { readonly id: string } }) => {
      recorder.deleteCalls.push(input.path.id);
    },
  };
}

function createCtx(options: FakeOptions = {}): { readonly ctx: PluginInput; readonly recorder: FakeRecorder } {
  const recorder: FakeRecorder = { promptCalls: [], deleteCalls: [] };
  const ctx = {
    directory: "/tmp/resume-subagent-test",
    client: { session: buildSession(recorder, options) },
  } as unknown as PluginInput;
  return { ctx, recorder };
}

async function callExecute(toolDef: ReturnType<typeof createResumeSubagentTool>, args: unknown): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, {});
}

describe("createResumeSubagentTool", () => {
  it("returns a stable hard failure when the session is not preserved", async () => {
    const registry = createRegistry();
    const { ctx, recorder } = createCtx();
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain("**SessionID**: -");
    expect(output).toContain("Session not preserved or expired.");
    expect(recorder.promptCalls).toEqual([]);
  });

  it("stops at the configured maximum resume count", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    for (let index = 0; index < config.subagent.maxResumesPerSession; index += 1) {
      registry.incrementResume(SESSION_ID);
    }
    const { ctx, recorder } = createCtx();
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain(`**Resume count**: ${config.subagent.maxResumesPerSession}`);
    expect(output).toContain("Maximum resume count reached.");
    expect(recorder.promptCalls).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it("resumes once, formats success, and cleans up the preserved session", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({ assistantText: SUCCESS_OUTPUT });
    const toolDef = createResumeSubagentTool(ctx, { registry });
    const hint = "Run the focused test before reporting.";

    const output = await callExecute(toolDef, { session_id: SESSION_ID, hint });

    expect(output).toContain("**Outcome**: success");
    expect(output).toContain(`**SessionID**: ${SESSION_ID}`);
    expect(output).toContain("**Resume count**: 1");
    expect(output).toContain(SUCCESS_OUTPUT);
    expect(recorder.promptCalls).toEqual([
      {
        id: SESSION_ID,
        text: buildSubagentResumePrompt({ errorType: SPAWN_OUTCOMES.TASK_ERROR, hint }),
      },
    ]);
    expect(recorder.deleteCalls).toEqual([SESSION_ID]);
    expect(registry.size()).toBe(0);
  });

  it("classifies a transient resume failure as a terminal hard failure", async () => {
    const registry = createRegistry();
    preserveSession(registry);
    const { ctx, recorder } = createCtx({ promptError: new Error(TRANSIENT_MESSAGE) });
    const toolDef = createResumeSubagentTool(ctx, { registry });

    const output = await callExecute(toolDef, { session_id: SESSION_ID });

    expect(output).toContain("**Outcome**: hard_failure");
    expect(output).toContain("**Resume count**: 1");
    expect(output).toContain(TRANSIENT_MESSAGE);
    expect(recorder.deleteCalls).toEqual([SESSION_ID]);
    expect(registry.size()).toBe(0);
  });
});
