import { INTERNAL_CLASSES, type InternalClass } from "./classify";

export interface RetryOptions {
  readonly retries: number;
  readonly backoffMs: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

const EMPTY_BACKOFF_DELAY_MS = 0;
const INITIAL_RETRIES = 0;
const RETRY_INCREMENT = 1;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function getBackoffDelay(backoffMs: readonly number[], retries: number): number {
  if (backoffMs.length === 0) {
    return EMPTY_BACKOFF_DELAY_MS;
  }
  const index = Math.min(retries, backoffMs.length - RETRY_INCREMENT);
  return backoffMs[index] ?? EMPTY_BACKOFF_DELAY_MS;
}

function shouldRetry(outcome: InternalClass, retries: number, limit: number): boolean {
  return outcome === INTERNAL_CLASSES.TRANSIENT && retries < limit;
}

export async function retryOnTransient<T>(
  attempt: () => Promise<{ readonly class: InternalClass; readonly value: T }>,
  options: RetryOptions,
): Promise<{ readonly class: InternalClass; readonly value: T; readonly retries: number }> {
  const sleep = options.sleep ?? defaultSleep;
  let retries = INITIAL_RETRIES;
  let outcome = await attempt();

  while (shouldRetry(outcome.class, retries, options.retries)) {
    const delay = getBackoffDelay(options.backoffMs, retries);
    await sleep(delay);
    retries += RETRY_INCREMENT;
    outcome = await attempt();
  }

  return { ...outcome, retries };
}
