/**
 * Shared predicate for "recoverable upstream/provider transient failure".
 *
 * Used by:
 *   - src/hooks/session-recovery.ts (built-in Task / executor-direct continuation)
 *   - src/octto/auto-resume/dispatcher.ts (answer -> owner session prompt)
 *   - src/tools/spawn-agent/classify-tokens.ts (vocabulary alignment; spawn_agent
 *     keeps its own 45s budget but shares the same token set)
 *
 * Out of scope:
 *   - src/lifecycle/** (push/merge/PR-check use their own backoff; see Task 3.4 drift guard)
 *   - ordinary chat / src/index.ts prompt path (not a continuation card)
 *
 * Returns true only for transient upstream/provider failures that are safe to
 * retry by re-prompting the SAME session with a recovery wording. Auth, quota,
 * config, user-cancel, and semantic/protocol errors return false; those are
 * either non-retryable or handled by other hooks.
 */

// Lower-cased substrings indicating a recoverable upstream/provider transient.
// Keep in sync with tests/workflow-retry/upstream-predicate.test.ts.
const RECOVERABLE_UPSTREAM_PATTERNS: readonly string[] = [
  "upstream_error",
  "upstream request failed",
  "internal_error; received from peer",
  "stream error: stream id",
];

// Lower-cased substrings indicating the failure is NON-recoverable even if it
// happens to contain an upstream-like phrase. Auth/quota/config/user-cancel
// must NOT be auto-retried for 10 minutes.
const NON_RECOVERABLE_PATTERNS: readonly string[] = [
  "unauthorized",
  "invalid api key",
  "quota",
  "rate limit",
  "not configured",
  "invalid model",
  "aborted by user",
  "user canceled",
  "user cancelled",
  // Semantic / protocol errors handled by existing session-recovery RECOVERABLE_ERRORS.
  "tool_result block",
  "thinking blocks must be at the start",
  "thinking is not enabled",
  "content cannot be empty",
];

function extractMessage(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in (error as Record<string, unknown>)) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function isRecoverableUpstreamError(error: unknown): boolean {
  const message = extractMessage(error).toLowerCase();
  if (message.length === 0) return false;
  for (const pattern of NON_RECOVERABLE_PATTERNS) {
    if (message.includes(pattern)) return false;
  }
  for (const pattern of RECOVERABLE_UPSTREAM_PATTERNS) {
    if (message.includes(pattern)) return true;
  }
  return false;
}

export const RECOVERABLE_UPSTREAM_PATTERNS_FOR_TEST = RECOVERABLE_UPSTREAM_PATTERNS;
export const NON_RECOVERABLE_PATTERNS_FOR_TEST = NON_RECOVERABLE_PATTERNS;
