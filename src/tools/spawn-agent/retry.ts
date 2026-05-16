import { INTERNAL_CLASSES, type InternalClass } from "./classify";

export interface RetryOptions {
  readonly retries: number;
  readonly backoffMs: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly retryBudgetMs?: number;
  readonly now?: () => number;
}

const EMPTY_BACKOFF_DELAY_MS = 0;
const INITIAL_RETRIES = 0;
const RETRY_INCREMENT = 1;

interface NormalizedRetryBudget {
  readonly budgetMs: number;
  readonly hasBudget: boolean;
}

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

function normalizeRetryBudget(budgetMs: number | undefined): NormalizedRetryBudget {
  if (budgetMs === undefined || !Number.isFinite(budgetMs)) {
    return { budgetMs: 0, hasBudget: false };
  }

  return { budgetMs: Math.max(0, budgetMs), hasBudget: true };
}

function isBudgetExhausted(budget: NormalizedRetryBudget, startedAt: number, now: () => number): boolean {
  return isBudgetExhaustedAtElapsed(budget, now() - startedAt);
}

function isBudgetExhaustedAtElapsed(budget: NormalizedRetryBudget, elapsedMs: number): boolean {
  return budget.hasBudget && elapsedMs >= budget.budgetMs;
}

function wouldExceedRetryBudgetAtElapsed(budget: NormalizedRetryBudget, elapsedMs: number, delayMs: number): boolean {
  if (!budget.hasBudget) {
    return false;
  }

  const remainingBudgetMs = budget.budgetMs - elapsedMs;
  return delayMs > remainingBudgetMs;
}

export async function retryOnTransient<T>(
  attempt: () => Promise<{ readonly class: InternalClass; readonly value: T }>,
  options: RetryOptions,
): Promise<{
  readonly class: InternalClass;
  readonly value: T;
  readonly retries: number;
  readonly budgetExhausted: boolean;
}> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const budget = normalizeRetryBudget(options.retryBudgetMs);
  const startedAt = now();
  let retries = INITIAL_RETRIES;
  let outcome = await attempt();
  let budgetExhausted = false;

  while (shouldRetry(outcome.class, retries, options.retries)) {
    const elapsedMs = now() - startedAt;
    if (isBudgetExhaustedAtElapsed(budget, elapsedMs)) {
      budgetExhausted = true;
      break;
    }

    const delay = getBackoffDelay(options.backoffMs, retries);
    if (wouldExceedRetryBudgetAtElapsed(budget, elapsedMs, delay)) {
      budgetExhausted = true;
      break;
    }

    await sleep(delay);

    if (isBudgetExhausted(budget, startedAt, now)) {
      budgetExhausted = true;
      break;
    }

    retries += RETRY_INCREMENT;
    outcome = await attempt();
  }

  return { ...outcome, retries, budgetExhausted };
}
