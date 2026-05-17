/**
 * Bounded retry policy for workflow continuation (built-in Task / executor-direct
 * via session-recovery, and Octto auto-resume answer -> owner prompt).
 *
 * Out of scope:
 *   - spawn_agent's own retry budget (config.subagent.transientRetryBudgetMs = 45s).
 *     spawn_agent does NOT replace its budget with this policy in this issue; see
 *     Task 2.3 for vocabulary-only alignment.
 *   - lifecycle git/GitHub push / merge / PR-check (config.lifecycle.* governs those).
 *   - ordinary chat / src/index.ts prompt path.
 *
 * Numbers come from design.md user-confirmed defaults: 20 attempts x 30 seconds.
 * They are intentionally hard-coded constants (not env-overridable) for this
 * iteration; if migration to config.workflowRetry.* is needed later, do it via
 * a separate design.
 */

// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- bounded retry policy literals
export const DEFAULT_MAX_ATTEMPTS = 20;
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- bounded retry policy literals
export const DEFAULT_INTERVAL_MS = 30_000;

export interface WorkflowContinuationRetryPolicy {
  readonly maxAttempts: number;
  readonly intervalMs: number;
  /** Build a stable dedup / attempt-counter key from sessionId + error class. */
  readonly attemptKey: (sessionId: string, errorClass: string) => string;
}

export const WORKFLOW_CONTINUATION_RETRY_POLICY: WorkflowContinuationRetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  intervalMs: DEFAULT_INTERVAL_MS,
  attemptKey: (sessionId: string, errorClass: string): string => `${sessionId}:${errorClass}`,
});
