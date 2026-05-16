import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import type { ContextCapsuleRef } from "@/agents/context-capsule/types";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent";

const SCOUT_COUNT = 5;

const sharedContextCapsule: ContextCapsuleRef = {
  path: "thoughts/shared/context-capsules/issue-91-lens-swarm.md",
  sha: "capsule-sha-lens-swarm-001",
  token: "fresh-token-lens-swarm-001",
  content: `---
lifecycle_issue: 91
branch: issue-91-working-context-capsule-subagent-user-prompt-pro
---

## Shared Lens Swarm Capsule

- All brainstorm-scout workers must receive this shared body byte-identically.
- Frontmatter is storage metadata and must not enter spawned user prompts.
`,
};

interface PromptCall {
  readonly id: string;
  readonly agent: string;
  readonly text: string;
}

interface Recorder {
  createCalls: number;
  readonly promptCalls: PromptCall[];
}

interface FakeCtx {
  readonly ctx: PluginInput;
  readonly recorder: Recorder;
}

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

function buildSession(recorder: Recorder) {
  return {
    create: async () => {
      recorder.createCalls += 1;
      return { data: { id: `scout-session-${recorder.createCalls}` } };
    },
    prompt: async (input: {
      readonly path: { readonly id: string };
      readonly body: { readonly agent: string; readonly parts: readonly { readonly text: string }[] };
    }) => {
      recorder.promptCalls.push({
        id: input.path.id,
        agent: input.body.agent,
        text: input.body.parts[0]?.text ?? "",
      });
    },
    messages: async () => ({
      data: [
        {
          info: { role: "assistant" as const },
          parts: [{ type: "text", text: "Lens scout completed successfully." }],
        },
      ],
    }),
    delete: async () => {
      /* noop */
    },
  };
}

function createFakeCtx(): FakeCtx {
  const recorder: Recorder = { createCalls: 0, promptCalls: [] };
  const ctx = {
    directory: "/tmp/context-capsule-lens-swarm-test",
    client: { session: buildSession(recorder) },
  } as unknown as PluginInput;
  return { ctx, recorder };
}

async function callExecute(toolDef: ReturnType<typeof createSpawnAgentTool>, args: unknown): Promise<string> {
  const execute = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return execute(args, { sessionID: "parent-lens-swarm-session" });
}

function capsuleBlockBeforeSpawnMeta(promptText: string): string {
  const spawnMetaIndex = promptText.indexOf("<spawn-meta");
  expect(spawnMetaIndex).toBeGreaterThan(0);
  return promptText.slice(0, spawnMetaIndex);
}

describe("context capsule lens swarm integration", () => {
  let restoreConsoleLog: (() => void) | null = null;

  beforeEach(() => {
    const originalLog = console.log;
    console.log = (_message?: unknown, ..._optional: unknown[]) => undefined;
    restoreConsoleLog = () => {
      console.log = originalLog;
    };
  });

  afterEach(() => {
    restoreConsoleLog?.();
    restoreConsoleLog = null;
  });

  it("prefixes five parallel brainstorm-scout prompts with the same byte-identical capsule", async () => {
    const fake = createFakeCtx();
    const toolDef = createSpawnAgentTool(fake.ctx);
    const agents = Array.from({ length: SCOUT_COUNT }, (_, index) => ({
      agent: "brainstorm-scout",
      description: `Lens scout ${index + 1}`,
      prompt: `<spawn-meta task-id="lens-swarm-${index + 1}" />\nInvestigate lens ${index + 1}.`,
      contextCapsule: sharedContextCapsule,
    }));

    const output = await callExecute(toolDef, { agents });

    expect(output).toContain("| Description | Agent | Outcome | Elapsed | Output snippet |");
    expect(fake.recorder.promptCalls).toHaveLength(SCOUT_COUNT);
    expect(fake.recorder.promptCalls.every((call) => call.agent === "brainstorm-scout")).toBe(true);

    const capsuleBlocks = fake.recorder.promptCalls.map((call) => capsuleBlockBeforeSpawnMeta(call.text));
    const [firstBlock, ...remainingBlocks] = capsuleBlocks;

    expect(firstBlock).toStartWith("<context-capsule");
    for (const block of remainingBlocks) {
      expect(block).toBe(firstBlock);
    }

    expect(firstBlock).toContain("## Shared Lens Swarm Capsule");
    expect(firstBlock).toContain("- All brainstorm-scout workers must receive this shared body byte-identically.");
    expect(firstBlock).toContain("- Frontmatter is storage metadata and must not enter spawned user prompts.");
    expect(firstBlock).not.toContain("---");
    expect(firstBlock).not.toContain("lifecycle_issue");
    expect(firstBlock).not.toContain("branch:");
  });
});
