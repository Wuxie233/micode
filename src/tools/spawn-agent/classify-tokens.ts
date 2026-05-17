import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

export { isRecoverableUpstreamError };

/**
 * spawn_agent has a fast inner retry boundary: transient classifier hits are
 * retried according to config.subagent.transientRetries and
 * config.subagent.transientRetryBudgetMs (currently 2 retries within 45s).
 * Workflow continuation retry is the outer boundary and lives in
 * src/workflow-retry/** (currently 20 attempts x 30s). Keep the vocabulary
 * aligned with isRecoverableUpstreamError without replacing spawn_agent's
 * smaller retry budget with the workflow continuation policy.
 */
export const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  /\bupstream_error\b/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /fetch failed/i,
  /socket hang up/i,
  /stream\s+(aborted|reset|closed)/i,
  /stream\s+ID\s+\d+;\s*INTERNAL_ERROR/i,
];

export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_SERVICE_UNAVAILABLE = 503;
export const HTTP_GATEWAY_TIMEOUT = 504;

export const TRANSIENT_HTTP_STATUSES: readonly number[] = [
  HTTP_TOO_MANY_REQUESTS,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
];

export const TASK_ERROR_MARKERS: readonly string[] = ["TEST FAILED", "BUILD FAILED"];
export const REVIEW_DECISION_MARKERS: readonly string[] = ["CHANGES REQUESTED"];
export const BLOCKED_MARKERS: readonly string[] = ["BLOCKED:", "ESCALATE:"];

export function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

export function containsAnyMarker(value: string, markers: readonly string[]): boolean {
  return markers.some((m) => value.includes(m));
}
