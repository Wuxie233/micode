import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ModelReference } from "@/utils/model-selection";
import { type AttemptRegistry, createAttemptRegistry } from "@/workflow-retry/attempt-registry";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "@/workflow-retry/policy";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";
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

interface DispatchBatch {
  readonly conversationId: string;
  readonly questionIds: readonly string[];
}

const LOG_SCOPE = "octto.auto-resume";
const DISPATCH_WARNING = "Failed to dispatch auto-resume prompt";
const DEFAULT_QUIET_WINDOW_MS = 200;
const UPSTREAM_ERROR_CLASS = "upstream_error";
const UPSTREAM_ATTEMPT_EXPIRY_MS = WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs * 2;

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

function buildPendingKey(ownerSessionId: string, conversationId: string): string {
  return `${ownerSessionId}:${conversationId}`;
}

function snapshotBatch(batch: PendingBatch): DispatchBatch {
  return {
    conversationId: batch.conversationId,
    questionIds: [...batch.questionIds],
  };
}

function buildUpstreamAttemptKey(ownerSessionId: string, conversationId: string): string {
  return WORKFLOW_CONTINUATION_RETRY_POLICY.attemptKey(`${ownerSessionId}:${conversationId}`, UPSTREAM_ERROR_CLASS);
}

function scheduleUpstreamRetry(
  input: AutoResumeDispatcherInput,
  scheduler: Scheduler,
  upstreamAttempts: AttemptRegistry,
  ownerSessionId: string,
  batch: DispatchBatch,
): void {
  const key = buildUpstreamAttemptKey(ownerSessionId, batch.conversationId);
  if (!upstreamAttempts.beginProcessing(key)) return;

  const { exhausted } = upstreamAttempts.record(key);
  if (exhausted) {
    upstreamAttempts.endProcessing(key);
    log.warn(
      LOG_SCOPE,
      `${DISPATCH_WARNING}: upstream retry exhausted after ${WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts} attempts`,
    );
    return;
  }

  scheduler.schedule(() => {
    upstreamAttempts.endProcessing(key);
    void dispatchBatch(input, scheduler, upstreamAttempts, ownerSessionId, batch);
  }, WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);
}

async function dispatchBatch(
  input: AutoResumeDispatcherInput,
  scheduler: Scheduler,
  upstreamAttempts: AttemptRegistry,
  ownerSessionId: string,
  batch: DispatchBatch,
): Promise<void> {
  const model = await resolveModel(input, ownerSessionId);

  try {
    const text = input.buildPrompt({ conversationId: batch.conversationId, questionIds: batch.questionIds });
    await input.client.session.prompt(createPromptRequest(ownerSessionId, text, model));
    upstreamAttempts.clearSession(ownerSessionId);
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
    if (isRecoverableUpstreamError(error)) {
      scheduleUpstreamRetry(input, scheduler, upstreamAttempts, ownerSessionId, batch);
    }
  }
}

async function flush(
  input: AutoResumeDispatcherInput,
  pending: Map<string, PendingBatch>,
  scheduler: Scheduler,
  upstreamAttempts: AttemptRegistry,
  ownerSessionId: string,
  pendingKey: string,
): Promise<void> {
  const batch = pending.get(pendingKey);
  if (!batch) return;
  pending.delete(pendingKey);

  await dispatchBatch(input, scheduler, upstreamAttempts, ownerSessionId, snapshotBatch(batch));
}

function scheduleFlush(
  input: AutoResumeDispatcherInput,
  pending: Map<string, PendingBatch>,
  scheduler: Scheduler,
  upstreamAttempts: AttemptRegistry,
  quietWindowMs: number,
  ownerSessionId: string,
  pendingKey: string,
): ScheduledHandle {
  return scheduler.schedule(() => {
    void flush(input, pending, scheduler, upstreamAttempts, ownerSessionId, pendingKey);
  }, quietWindowMs);
}

export function createAutoResumeDispatcher(input: AutoResumeDispatcherInput): AutoResumeDispatcher {
  const scheduler = input.scheduler ?? createDefaultScheduler();
  const quietWindowMs = input.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const pending = new Map<string, PendingBatch>();
  const upstreamAttempts = createAttemptRegistry({
    maxAttempts: WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts,
    expiryMs: UPSTREAM_ATTEMPT_EXPIRY_MS,
  });

  return {
    handle: async (event) => {
      const ownerSessionId = input.registry.lookup(event.conversationId);
      if (!ownerSessionId) return;

      const pendingKey = buildPendingKey(ownerSessionId, event.conversationId);
      const batch = pending.get(pendingKey) ?? {
        conversationId: event.conversationId,
        questionIds: [],
        questionIdSet: new Set<string>(),
        handle: null,
      };

      batch.handle?.cancel();
      appendQuestionId(batch, event.questionId);
      batch.handle = scheduleFlush(
        input,
        pending,
        scheduler,
        upstreamAttempts,
        quietWindowMs,
        ownerSessionId,
        pendingKey,
      );
      pending.set(pendingKey, batch);
    },
  };
}
