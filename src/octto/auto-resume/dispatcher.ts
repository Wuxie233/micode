import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { buildContinuePrompt } from "./prompt";
import type { AutoResumeRegistry } from "./registry";

export interface AutoResumeEvent {
  readonly conversationId: string;
  readonly ownerSessionId: string;
  readonly questionId: string;
  readonly answeredAt: number;
}

export interface ClientPromptRequest {
  readonly path: {
    readonly id: string;
  };
  readonly body: {
    readonly parts: readonly [
      {
        readonly type: "text";
        readonly text: string;
      },
    ];
  };
}

export interface AutoResumeDispatcher {
  readonly handle: (event: AutoResumeEvent) => Promise<void>;
}

interface AutoResumeClient {
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<unknown>;
  };
}

interface AutoResumeDispatcherInput {
  readonly client: AutoResumeClient;
  readonly registry: AutoResumeRegistry;
  readonly buildPrompt: typeof buildContinuePrompt;
}

const LOG_SCOPE = "octto.auto-resume";
const DISPATCH_WARNING = "Failed to dispatch auto-resume prompt";

const createPromptRequest = (ownerSessionId: string, text: string): ClientPromptRequest => ({
  path: { id: ownerSessionId },
  body: {
    parts: [{ type: "text", text }],
  },
});

async function dispatch(input: AutoResumeDispatcherInput, event: AutoResumeEvent): Promise<void> {
  const ownerSessionId = input.registry.lookup(event.conversationId);
  if (!ownerSessionId) return;

  try {
    const text = input.buildPrompt({ conversationId: event.conversationId, questionId: event.questionId });
    await input.client.session.prompt(createPromptRequest(ownerSessionId, text));
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
  }
}

export function createAutoResumeDispatcher(input: AutoResumeDispatcherInput): AutoResumeDispatcher {
  return {
    handle: (event) => dispatch(input, event),
  };
}
