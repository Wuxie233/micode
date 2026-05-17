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

interface AttemptRegistryState {
  readonly attempts: Map<string, number>;
  readonly processing: Set<string>;
  readonly expiryTimers: Map<string, ReturnType<typeof setTimeout>>;
}

function clearExpiry(expiryTimers: AttemptRegistryState["expiryTimers"], key: string): void {
  const timer = expiryTimers.get(key);
  if (timer === undefined) {
    return;
  }

  clearTimeout(timer);
  expiryTimers.delete(key);
}

function buildResult(attempt: number, maxAttempts: number): RecordResult {
  return {
    attempt,
    exhausted: attempt >= maxAttempts,
  };
}

function createRecord(state: AttemptRegistryState, maxAttempts: number): AttemptRegistry["record"] {
  return (key) => {
    const current = state.attempts.get(key) ?? 0;
    if (current >= maxAttempts) {
      return buildResult(current, maxAttempts);
    }

    const next = Math.min(current + 1, maxAttempts);
    state.attempts.set(key, next);
    return buildResult(next, maxAttempts);
  };
}

function createBeginProcessing(state: AttemptRegistryState, expiryMs: number): AttemptRegistry["beginProcessing"] {
  return (key) => {
    if (state.processing.has(key)) {
      return false;
    }

    state.processing.add(key);
    clearExpiry(state.expiryTimers, key);
    const timer = setTimeout(() => {
      state.processing.delete(key);
      state.expiryTimers.delete(key);
    }, expiryMs);
    state.expiryTimers.set(key, timer);
    return true;
  };
}

function createEndProcessing(state: AttemptRegistryState): AttemptRegistry["endProcessing"] {
  return (key) => {
    state.processing.delete(key);
    clearExpiry(state.expiryTimers, key);
  };
}

function clearMatchingKeys(state: AttemptRegistryState, prefix: string): void {
  for (const key of state.attempts.keys()) {
    if (key.startsWith(prefix)) {
      state.attempts.delete(key);
    }
  }

  for (const key of state.processing) {
    if (key.startsWith(prefix)) {
      state.processing.delete(key);
      clearExpiry(state.expiryTimers, key);
    }
  }
}

function createClearSession(state: AttemptRegistryState): AttemptRegistry["clearSession"] {
  return (sessionId) => {
    clearMatchingKeys(state, `${sessionId}:`);
  };
}

function createReset(state: AttemptRegistryState): AttemptRegistry["reset"] {
  return () => {
    state.attempts.clear();
    state.processing.clear();
    for (const timer of state.expiryTimers.values()) {
      clearTimeout(timer);
    }
    state.expiryTimers.clear();
  };
}

export function createAttemptRegistry(options: AttemptRegistryOptions): AttemptRegistry {
  const state: AttemptRegistryState = {
    attempts: new Map<string, number>(),
    processing: new Set<string>(),
    expiryTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  };

  return {
    record: createRecord(state, options.maxAttempts),
    beginProcessing: createBeginProcessing(state, options.expiryMs),
    endProcessing: createEndProcessing(state),
    clearSession: createClearSession(state),
    reset: createReset(state),
  };
}
