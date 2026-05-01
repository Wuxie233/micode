import type { PluginInput } from "@opencode-ai/plugin";

import { extractErrorMessage } from "@/utils/errors";
import { deleteInternalSession } from "@/utils/internal-session";
import { log } from "@/utils/logger";
import type { SpawnSessionRegistry } from "./spawn-session-registry";

export interface CleanupGenerationInput {
  readonly ctx: PluginInput;
  readonly registry: SpawnSessionRegistry;
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly reason: string;
}

export interface CleanupFailure {
  readonly sessionId: string;
  readonly error: string;
}

export interface CleanupResult {
  readonly aborted: number;
  readonly deleted: number;
  readonly failures: readonly CleanupFailure[];
}

const LOG_MODULE = "spawn-agent.cleanup";

interface DeleteAttempt {
  readonly sessionId: string;
  readonly error: Error | null;
}

interface WarningSink {
  readonly errors: string[];
}

function collectWarnings(): WarningSink {
  return { errors: [] };
}

function warningCollector(sink: WarningSink): { warn: (_mod: string, message: string) => void } {
  return {
    warn(_mod, message) {
      sink.errors.push(message);
    },
  };
}

function lastError(sink: WarningSink): Error | null {
  const error = sink.errors.at(-1);
  if (error === undefined) return null;
  return new Error(error);
}

async function attemptDelete(ctx: PluginInput, sessionId: string): Promise<DeleteAttempt> {
  const warnings = collectWarnings();
  try {
    await deleteInternalSession({ ctx, sessionId, agent: LOG_MODULE, logger: warningCollector(warnings) });
    return { sessionId, error: lastError(warnings) };
  } catch (error) {
    return { sessionId, error: new Error(extractErrorMessage(error)) };
  }
}

export async function cleanupGeneration(input: CleanupGenerationInput): Promise<CleanupResult> {
  const aborted = input.registry.abortGeneration({
    ownerSessionId: input.ownerSessionId,
    runId: input.runId,
    generation: input.generation,
    reason: input.reason,
  });
  if (aborted.length === 0) return { aborted: 0, deleted: 0, failures: [] };

  const attempts = await Promise.all(aborted.map((record) => attemptDelete(input.ctx, record.sessionId)));
  const failures: CleanupFailure[] = [];
  let deleted = 0;
  for (const attempt of attempts) {
    if (attempt.error === null) {
      deleted += 1;
      continue;
    }
    failures.push({ sessionId: attempt.sessionId, error: attempt.error.message });
  }
  log.info(LOG_MODULE, `aborted=${aborted.length} deleted=${deleted} failed=${failures.length} reason=${input.reason}`);
  return { aborted: aborted.length, deleted, failures };
}
