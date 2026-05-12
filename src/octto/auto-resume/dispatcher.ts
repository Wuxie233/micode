import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ModelReference } from "@/utils/model-selection";
import type { OwnerModelLookup } from "./model-lookup";
import type { AutoResumeRegistry } from "./registry";
import { createDefaultScheduler, type ScheduledHandle, type Scheduler } from "./scheduler";

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
    readonly model?: ModelReference;
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

interface ContinuePromptInput {
  readonly conversationId: string;
  readonly questionIds: readonly string[];
}

interface AutoResumeDispatcherInput {
  readonly client: AutoResumeClient;
  readonly registry: AutoResumeRegistry;
  readonly buildPrompt: (input: ContinuePromptInput) => string;
  readonly modelLookup: OwnerModelLookup;
  readonly scheduler?: Scheduler;
  readonly quietWindowMs?: number;
}

interface PendingBatch {
  readonly conversationId: string;
  readonly questionIds: string[];
  readonly questionIdSet: Set<string>;
  handle: ScheduledHandle | null;
}

const LOG_SCOPE = "octto.auto-resume";
const DISPATCH_WARNING = "Failed to dispatch auto-resume prompt";
const DEFAULT_QUIET_WINDOW_MS = 200;

const createPromptRequest = (
  ownerSessionId: string,
  text: string,
  model: ModelReference | null,
): ClientPromptRequest => ({
  path: { id: ownerSessionId },
  body: {
    parts: [{ type: "text", text }],
    ...(model ? { model } : {}),
  },
});

function appendQuestionId(batch: PendingBatch, questionId: string): void {
  if (batch.questionIdSet.has(questionId)) return;

  batch.questionIdSet.add(questionId);
  batch.questionIds.push(questionId);
}

async function resolveModel(input: AutoResumeDispatcherInput, ownerSessionId: string): Promise<ModelReference | null> {
  try {
    return await input.modelLookup.resolve(ownerSessionId);
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
    return null;
  }
}

async function flush(
  input: AutoResumeDispatcherInput,
  pending: Map<string, PendingBatch>,
  ownerSessionId: string,
): Promise<void> {
  const batch = pending.get(ownerSessionId);
  if (!batch) return;
  pending.delete(ownerSessionId);

  const model = await resolveModel(input, ownerSessionId);

  try {
    const text = input.buildPrompt({ conversationId: batch.conversationId, questionIds: batch.questionIds });
    await input.client.session.prompt(createPromptRequest(ownerSessionId, text, model));
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
  }
}

function scheduleFlush(
  input: AutoResumeDispatcherInput,
  pending: Map<string, PendingBatch>,
  scheduler: Scheduler,
  quietWindowMs: number,
  ownerSessionId: string,
): ScheduledHandle {
  return scheduler.schedule(() => {
    void flush(input, pending, ownerSessionId);
  }, quietWindowMs);
}

export function createAutoResumeDispatcher(input: AutoResumeDispatcherInput): AutoResumeDispatcher {
  const scheduler = input.scheduler ?? createDefaultScheduler();
  const quietWindowMs = input.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const pending = new Map<string, PendingBatch>();

  return {
    handle: async (event) => {
      const ownerSessionId = input.registry.lookup(event.conversationId);
      if (!ownerSessionId) return;

      const batch = pending.get(ownerSessionId) ?? {
        conversationId: event.conversationId,
        questionIds: [],
        questionIdSet: new Set<string>(),
        handle: null,
      };

      batch.handle?.cancel();
      appendQuestionId(batch, event.questionId);
      batch.handle = scheduleFlush(input, pending, scheduler, quietWindowMs, ownerSessionId);
      pending.set(ownerSessionId, batch);
    },
  };
}
