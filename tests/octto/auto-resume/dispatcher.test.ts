import { describe, expect, it } from "bun:test";

import type { ClientPromptRequest } from "../../../src/octto/auto-resume/dispatcher";
import { type AutoResumeEvent, createAutoResumeDispatcher } from "../../../src/octto/auto-resume/dispatcher";
import { buildContinuePrompt } from "../../../src/octto/auto-resume/prompt";
import { createAutoResumeRegistry } from "../../../src/octto/auto-resume/registry";

const CONVERSATION_ID = "conversation-1";
const OWNER_SESSION_ID = "owner-session-1";
const QUESTION_ID = "question-1";
const ANSWERED_AT = 1_774_220_000_000;
const WARNING = "[octto.auto-resume] Failed to dispatch auto-resume prompt: prompt failed";

interface RecordedClient {
  readonly calls: ClientPromptRequest[];
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<void>;
  };
}

const EVENT: AutoResumeEvent = {
  conversationId: CONVERSATION_ID,
  ownerSessionId: OWNER_SESSION_ID,
  questionId: QUESTION_ID,
  answeredAt: ANSWERED_AT,
};

function createRecordedClient(): RecordedClient {
  const calls: ClientPromptRequest[] = [];

  return {
    calls,
    session: {
      prompt: async (request) => {
        calls.push(request);
      },
    },
  };
}

async function captureWarnings(callback: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    await callback();
  } finally {
    console.warn = original;
  }

  return warnings;
}

describe("auto-resume dispatcher", () => {
  it("sends a continue prompt to the registered owner session", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({ client, registry, buildPrompt: buildContinuePrompt });

    await dispatcher.handle(EVENT);

    expect(client.calls).toEqual([
      {
        path: { id: OWNER_SESSION_ID },
        body: {
          parts: [
            {
              type: "text",
              text: buildContinuePrompt({ conversationId: CONVERSATION_ID, questionId: QUESTION_ID }),
            },
          ],
        },
      },
    ]);
  });

  it("skips dispatch when no owner session is registered", async () => {
    const client = createRecordedClient();
    const registry = createAutoResumeRegistry();
    const dispatcher = createAutoResumeDispatcher({ client, registry, buildPrompt: buildContinuePrompt });

    await dispatcher.handle(EVENT);

    expect(client.calls).toEqual([]);
  });

  it("swallows client prompt failures after logging a warning", async () => {
    const calls: ClientPromptRequest[] = [];
    const client = {
      session: {
        prompt: async (request: ClientPromptRequest) => {
          calls.push(request);
          throw new Error("prompt failed");
        },
      },
    };
    const registry = createAutoResumeRegistry();
    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    const dispatcher = createAutoResumeDispatcher({ client, registry, buildPrompt: buildContinuePrompt });

    const warnings = await captureWarnings(() => dispatcher.handle(EVENT));

    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([WARNING]);
  });
});
