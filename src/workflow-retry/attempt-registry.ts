/**
 * In-memory attempt counter + dedup processing window for bounded continuation
 * retry. Used by:
 *   - src/hooks/session-recovery.ts
 *   - src/octto/auto-resume/dispatcher.ts
 *
 * Out of scope: spawn_agent (its retry budget lives in src/tools/spawn-agent/retry.ts).
 *
 * Persistence: in-memory only; restart resets counters. This is acceptable
 * because OpenCode restarts already break the live conversation per
 * memory/runtime-core.md (no-auto-restart rule).
 */

export interface AttemptRegistryOptions {
  readonly maxAttempts: number;
  /** How long a `beginProcessing` lock remains before auto-release. */
  readonly expiryMs: number;
}

export interface RecordResult {
  /** 1-indexed attempt count for this key after recording. */
  readonly attempt: number;
  /** True when attempt >= maxAttempts; caller must stop and surface to user. */
  readonly exhausted: boolean;
}

export interface AttemptRegistry {
  /** Increment and return the new attempt count + exhausted flag. */
  readonly record: (key: string) => RecordResult;
  /** Begin a dedup window. Returns false if another beginProcessing is still active for this key. */
  readonly beginProcessing: (key: string) => boolean;
  /** End the dedup window early. Safe to call after the window has already expired. */
  readonly endProcessing: (key: string) => void;
  /** Drop all attempt counters and processing locks whose key starts with `${sessionId}:`. */
  readonly clearSession: (sessionId: string) => void;
  /** Drop all state. Test-only convenience. */
  readonly reset: () => void;
}

export function createAttemptRegistry(options: AttemptRegistryOptions): AttemptRegistry {
  const attempts = new Map<string, number>();
  const processing = new Set<string>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearExpiry = (key: string): void => {
    const timer = expiryTimers.get(key);
    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    expiryTimers.delete(key);
  };

  const buildResult = (attempt: number): RecordResult => ({
    attempt,
    exhausted: attempt >= options.maxAttempts,
  });

  return {
    record: (key) => {
      const current = attempts.get(key) ?? 0;
      if (current >= options.maxAttempts) {
        return buildResult(current);
      }

      const next = Math.min(current + 1, options.maxAttempts);
      attempts.set(key, next);
      return buildResult(next);
    },
    beginProcessing: (key) => {
      if (processing.has(key)) {
        return false;
      }

      processing.add(key);
      clearExpiry(key);
      const timer = setTimeout(() => {
        processing.delete(key);
        expiryTimers.delete(key);
      }, options.expiryMs);
      expiryTimers.set(key, timer);
      return true;
    },
    endProcessing: (key) => {
      processing.delete(key);
      clearExpiry(key);
    },
    clearSession: (sessionId) => {
      const prefix = `${sessionId}:`;
      for (const key of attempts.keys()) {
        if (key.startsWith(prefix)) {
          attempts.delete(key);
        }
      }
      for (const key of processing) {
        if (key.startsWith(prefix)) {
          processing.delete(key);
          clearExpiry(key);
        }
      }
    },
    reset: () => {
      attempts.clear();
      processing.clear();
      for (const timer of expiryTimers.values()) {
        clearTimeout(timer);
      }
      expiryTimers.clear();
    },
  };
}
