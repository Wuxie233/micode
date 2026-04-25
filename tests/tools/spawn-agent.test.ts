// tests/tools/spawn-agent.test.ts

import { beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { buildArgsShape, createSpawnAgentTool } from "../../src/tools/spawn-agent";
import { INVALID_ARGS_MESSAGE } from "../../src/tools/spawn-agent-args";

const taskA = {
  agent: "agent-a",
  prompt: "prompt a",
  description: "Task A description",
};

const taskB = {
  agent: "agent-b",
  prompt: "prompt b",
  description: "Task B description",
};

interface PromptCall {
  readonly id: string;
  readonly agent: string;
  readonly text: string;
}

interface FakeRecorder {
  createCalls: number;
  promptCalls: PromptCall[];
  lastAgent: string;
}

interface FakeCtx {
  ctx: PluginInput;
  recorder: FakeRecorder;
}

const buildSession = (recorder: FakeRecorder) => {
  return {
    create: async () => {
      recorder.createCalls += 1;
      return { data: { id: `sess-${recorder.createCalls}` } };
    },
    prompt: async (input: { path: { id: string }; body: { agent: string; parts: { text: string }[] } }) => {
      recorder.lastAgent = input.body.agent;
      recorder.promptCalls.push({
        id: input.path.id,
        agent: input.body.agent,
        text: input.body.parts[0].text,
      });
    },
    messages: async () => ({
      data: [
        {
          info: { role: "assistant" as const },
          parts: [{ type: "text", text: `OUT_${recorder.lastAgent}` }],
        },
      ],
    }),
    delete: async () => {
      /* noop */
    },
  };
};

const createFakeCtx = (): FakeCtx => {
  const recorder: FakeRecorder = { createCalls: 0, promptCalls: [], lastAgent: "" };
  const ctx = {
    directory: "/tmp/spawn-agent-test",
    client: { session: buildSession(recorder) },
  } as unknown as PluginInput;
  return { ctx, recorder };
};

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

const callExecute = async (toolDef: ReturnType<typeof createSpawnAgentTool>, args: unknown): Promise<string> => {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return exec(args, {});
};

describe("createSpawnAgentTool execute", () => {
  let fake: FakeCtx;
  let toolDef: ReturnType<typeof createSpawnAgentTool>;

  beforeEach(() => {
    fake = createFakeCtx();
    toolDef = createSpawnAgentTool(fake.ctx);
  });

  describe("accepted shapes", () => {
    it("runs single canonical wrapped-array task", async () => {
      const output = await callExecute(toolDef, { agents: [taskA] });

      expect(output.startsWith(`## ${taskA.description}`)).toBe(true);
      expect(fake.recorder.createCalls).toBe(1);
      expect(fake.recorder.promptCalls[0]?.agent).toBe(taskA.agent);
    });

    it("runs canonical two-task array in parallel", async () => {
      const output = await callExecute(toolDef, { agents: [taskA, taskB] });

      expect(output.startsWith("# 2 agents completed in")).toBe(true);
      expect(output.indexOf(taskA.description)).toBeLessThan(output.indexOf(taskB.description));
      expect(fake.recorder.createCalls).toBe(2);
    });

    it("runs top-level single task object", async () => {
      const output = await callExecute(toolDef, { ...taskA });

      expect(output.startsWith(`## ${taskA.description}`)).toBe(true);
      expect(fake.recorder.createCalls).toBe(1);
    });

    it("runs wrapped single task object", async () => {
      const output = await callExecute(toolDef, { agents: { ...taskA } });

      expect(output.startsWith(`## ${taskA.description}`)).toBe(true);
      expect(fake.recorder.createCalls).toBe(1);
    });

    it("runs top-level array with single task", async () => {
      const output = await callExecute(toolDef, [taskA]);

      expect(output.startsWith(`## ${taskA.description}`)).toBe(true);
      expect(fake.recorder.createCalls).toBe(1);
    });

    it("preserves order in parallel output", async () => {
      const output = await callExecute(toolDef, { agents: [taskB, taskA] });

      expect(output.indexOf(taskB.description)).toBeLessThan(output.indexOf(taskA.description));
      expect(fake.recorder.createCalls).toBe(2);
    });
  });

  describe("empty inputs", () => {
    it("returns stable failure for { agents: [] } and skips session.create", async () => {
      const output = await callExecute(toolDef, { agents: [] });

      expect(output).toBe("## spawn_agent Failed\n\nNo agents specified.");
      expect(fake.recorder.createCalls).toBe(0);
    });

    it("returns stable failure for top-level [] and skips session.create", async () => {
      const output = await callExecute(toolDef, []);

      expect(output).toBe("## spawn_agent Failed\n\nNo agents specified.");
      expect(fake.recorder.createCalls).toBe(0);
    });
  });

  describe("invalid shapes", () => {
    it("rejects task missing description", async () => {
      const output = await callExecute(toolDef, {
        agents: [{ agent: "x", prompt: "p" }],
      });

      expect(output.startsWith("## spawn_agent Failed")).toBe(true);
      expect(output).toContain(INVALID_ARGS_MESSAGE);
      expect(fake.recorder.createCalls).toBe(0);
    });

    it("rejects task with non-string agent", async () => {
      const output = await callExecute(toolDef, {
        agents: [{ agent: 1, prompt: "p", description: "d" }],
      });

      expect(output.startsWith("## spawn_agent Failed")).toBe(true);
      expect(output).toContain(INVALID_ARGS_MESSAGE);
      expect(fake.recorder.createCalls).toBe(0);
    });

    it("rejects { agents: 'implementer' }", async () => {
      const output = await callExecute(toolDef, { agents: "implementer" });

      expect(output.startsWith("## spawn_agent Failed")).toBe(true);
      expect(output).toContain(INVALID_ARGS_MESSAGE);
      expect(fake.recorder.createCalls).toBe(0);
    });

    it("rejects null input", async () => {
      const output = await callExecute(toolDef, null);

      expect(output.startsWith("## spawn_agent Failed")).toBe(true);
      expect(output).toContain(INVALID_ARGS_MESSAGE);
      expect(fake.recorder.createCalls).toBe(0);
    });
  });

  describe("stable failure text", () => {
    const invalidInputs: ReadonlyArray<readonly [string, unknown]> = [
      ["missing field", { agents: [{ agent: "x", prompt: "p" }] }],
      ["wrong field type", { agents: [{ agent: 1, prompt: "p", description: "d" }] }],
      ["bad container", { agents: "implementer" }],
      ["null", null],
    ];

    for (const [label, input] of invalidInputs) {
      it(`failure output for ${label} contains no JS internals`, async () => {
        const output = await callExecute(toolDef, input);

        expect(output).not.toContain("map is not a function");
        expect(output).not.toContain("agents2");
        expect(output).not.toContain("Cannot read");
      });
    }
  });

  describe("never throws", () => {
    it("resolves the promise on invalid input rather than rejecting", async () => {
      await expect(callExecute(toolDef, null)).resolves.toContain("## spawn_agent Failed");
    });
  });
});

describe("spawn_agent args schema (LLM gate layer)", () => {
  // The OpenCode tool dispatcher parses the LLM's tool call against this
  // zod object before invoking `execute`. We assert here that:
  //   1. canonical { agents: [task, ...] }                    -> accepted
  //   2. wrapped single task { agents: task }                 -> accepted
  //   3. top-level task without `agents` key                  -> rejected
  //
  // Case 3 is intentionally rejected at the schema layer because the tool
  // description tells LLMs to always wrap tasks under `agents`. The runtime
  // normalizer still tolerates that shape for non-LLM callers, but we don't
  // want it advertised through the JSON Schema.
  const argsSchema = tool.schema.object(buildArgsShape());

  const validTask = {
    agent: "agent-x",
    prompt: "do work",
    description: "Task X",
  };

  it("accepts canonical { agents: [task, ...] }", () => {
    const result = argsSchema.safeParse({ agents: [validTask] });
    expect(result.success).toBe(true);
  });

  it("accepts wrapped single task { agents: task }", () => {
    const result = argsSchema.safeParse({ agents: validTask });
    expect(result.success).toBe(true);
  });

  it("rejects top-level task without `agents` key", () => {
    const result = argsSchema.safeParse({ ...validTask });
    expect(result.success).toBe(false);
  });

  it("rejects { agents: 'string' }", () => {
    const result = argsSchema.safeParse({ agents: "implementer" });
    expect(result.success).toBe(false);
  });

  it("rejects task missing required field", () => {
    const result = argsSchema.safeParse({
      agents: [{ agent: "x", prompt: "p" }],
    });
    expect(result.success).toBe(false);
  });

  it("emits anyOf JSON Schema with array + object branches for LLMs", () => {
    // zod v4 ships z.toJSONSchema; older versions don't. If absent, this test
    // will surface that we can no longer rely on the LLM seeing structure.
    const toJSONSchema = (tool.schema as unknown as { toJSONSchema?: (s: unknown) => unknown }).toJSONSchema;
    expect(typeof toJSONSchema).toBe("function");
    if (typeof toJSONSchema !== "function") return;

    const json = toJSONSchema(argsSchema) as {
      properties?: { agents?: { anyOf?: unknown[] } };
    };
    const agentsSchema = json.properties?.agents;
    expect(agentsSchema).toBeDefined();
    expect(Array.isArray(agentsSchema?.anyOf)).toBe(true);
    expect(agentsSchema?.anyOf?.length).toBe(2);
  });
});
