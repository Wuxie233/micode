---
date: 2026-05-08
topic: empty-subagent-result-defense
status: approved
issue: 55
---

# Empty Subagent Assistant Result Defense

## Problem Statement

When a subagent session completes its prompt round-trip (`session.prompt` → `session.messages`),
the assistant message list may be empty or contain only whitespace. This happens today in two
independent paths:

1. **`spawn-agent` (`tool.ts`)** — `executeAgentSessionWith` calls `readAssistantText` on
   `messagesResp.data`. If the data array is empty or the last assistant message has no `text`
   parts, `output` is `""`. This is immediately fed to `classifySpawnError({ assistantText: "" })`,
   which returns `HARD_FAILURE` with reason `"empty response"` (see `classify.ts:147`).
   The caller never distinguishes a "messages API returned nothing yet" transient from a genuine
   empty-output hard failure, and produces a silent hard-failure result with no actionable detail.

2. **`resume-subagent` (`resume-subagent.ts`)** — `resumeSession` similarly calls
   `readAssistantText` then immediately classifies. Same silent `HARD_FAILURE` on empty.

The root symptom: a coordinator receives `outcome: hard_failure` with reason `"empty response"`,
no session to resume, no hint about whether a re-read would have recovered the session. This is
indistinguishable from a genuine processing failure, making it impossible to diagnose or retry.

### Why "empty response" can be transient

The OpenCode session messages API may return an empty assistant list if polled before the model
finishes streaming its final turn. In a fast-completing task the list is populated; in a slow or
back-pressured task the list may be momentarily empty. Neither `session.prompt` (which returns
before the model finishes) nor the subsequent `session.messages` call guarantees the model output
is ready. A minimal re-read backoff loop is sufficient to recover these cases without changing
the retry semantics already in `retryOnTransient`.

---

## Constraints

- **No Atlas change.** Atlas auto-inject must not be reduced or disabled. This issue is scoped
  strictly to result-read defense.
- **No OpenCode restart during implementation.** The fix must not require a service restart in
  the implementation phase.
- **Minimal scope.** Touch only the result-read path; do not alter transient retry semantics,
  classification logic, marker matching, verifier, or generation-fence.
- **Preserve existing transient retry contract.** `retryOnTransient` in `retry.ts` handles
  thrown-exception transients (ECONNRESET, HTTP 429/502/503/504). The new guard handles a
  separate concern: non-throwing empty-result reads. The two must remain orthogonal.
- **Explicit failure.** If the re-read guard exhausts its attempts and output is still empty,
  the result must surface a clear, machine-readable reason (not silent `"empty response"`).
- **No new external dependencies.**
- **Both paths covered.** `executeAgentSessionWith` (spawn path) and `resumeSession`
  (resume path) must both gain the guard, using a shared implementation.

---

## Approach

Insert a **non-throwing re-read guard** between the `session.messages` call and the
`classifySpawnError` call. The guard:

1. Reads assistant text from the messages response.
2. If non-empty, returns it immediately (zero overhead on the happy path).
3. If empty, sleeps a short configurable backoff and re-calls `session.messages` up to
   `N` times (config-driven, default 2 extra reads → 3 total attempts).
4. Returns the first non-empty read, or the empty string after exhaustion.

After the guard, if the result is still empty, classify as before — but the reason string is
enriched to distinguish "empty after N re-reads" from a plain first-read empty.

This approach:
- Does **not** change `classifySpawnError` input shape or output shape.
- Does **not** change `retryOnTransient` semantics.
- Is **synchronous from the caller's perspective** — the guard is awaited inside the
  existing `try/catch` blocks, so thrown errors from `session.messages` still propagate
  to `classifyThrown`.
- Is **testable in isolation** via a pure function that accepts a `readMessages` callback.

---

## Architecture

```
spawn-agent/tool.ts
│
├── executeAgentSessionWith()
│   ├── ctx.client.session.prompt(...)          ← unchanged
│   ├── ctx.client.session.messages(...)        ← unchanged (first read)
│   ├── [NEW] readAssistantTextWithRetry(...)   ← re-read guard (shared helper)
│   └── return { sessionId, output }
│
resume-subagent.ts
│
└── resumeSession()
    ├── ctx.client.session.prompt(...)          ← unchanged
    ├── ctx.client.session.messages(...)        ← unchanged (first read)
    ├── [NEW] readAssistantTextWithRetry(...)   ← same shared helper
    └── classifySpawnError({ assistantText: output })  ← unchanged
```

The shared helper lives in a new file:

```
src/tools/spawn-agent/read-guard.ts
```

Both callers import from it. No changes to `classify.ts`, `retry.ts`, `verifier.ts`,
`generation-fence.ts`, or `format.ts`.

---

## Components

### `src/tools/spawn-agent/read-guard.ts` (new file)

**Exports:**
```typescript
export interface ReadGuardOptions {
  readonly maxExtraReads: number;         // extra reads after first (default: 2)
  readonly backoffMs: readonly number[];  // per-retry sleep (default: [200, 500])
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReadGuardResult {
  readonly output: string;
  readonly extraReads: number;  // 0 on first-read hit; >0 means re-reads occurred
  readonly exhausted: boolean;  // true if all reads returned empty
}

export async function readAssistantTextWithRetry(
  firstOutput: string,
  reread: () => Promise<string>,
  options: ReadGuardOptions,
): Promise<ReadGuardResult>
```

**Behaviour contract:**
- If `firstOutput` is non-empty after trim, returns `{ output: firstOutput, extraReads: 0, exhausted: false }` immediately.
- Otherwise iterates up to `maxExtraReads` times: sleep(backoffMs[i]) → reread() → trim check.
- Returns on first non-empty re-read.
- After exhaustion returns `{ output: "", extraReads: maxExtraReads, exhausted: true }`.
- Never throws; all errors from `reread()` propagate unchanged (caller's try/catch handles them).

### `src/tools/spawn-agent/tool.ts` (modified)

**Change surface:** `executeAgentSessionWith` only. After the `session.messages` call:

```typescript
// Before (current):
return { sessionId, output: readAssistantText(messagesResp.data ?? []) };

// After (new):
const firstOutput = readAssistantText(messagesResp.data ?? []);
const guard = await readAssistantTextWithRetry(
  firstOutput,
  async () => {
    const resp = await ctx.client.session.messages({ path: { id: sessionId }, query: { directory: ctx.directory } });
    return readAssistantText((resp as SessionMessagesResponse).data ?? []);
  },
  config.subagent.readGuard,    // new config section (see below)
);
const output = guard.exhausted
  ? buildEmptyReadReason(guard.extraReads)   // new helper, returns enriched string
  : guard.output;
return { sessionId, output };
```

`buildEmptyReadReason(extraReads: number): string` returns a string that `classifySpawnError`
will classify as `HARD_FAILURE` (it is non-empty, contains no error markers, but is passed
separately so the reason is informative):

```
"empty assistant output after 3 read attempt(s)"
```

This is still classified `HARD_FAILURE` by `classifySpawnError` (falls through to `SUCCESS`
because it is non-empty and has no markers — **so a new path is needed**: see Data Flow below).

> **Design note:** the enriched reason string must be conveyed to the classifier as a
> non-assistant signal. Two options were evaluated:
>
> A. Pass the enriched string as `assistantText` and add a new marker to `classify.ts`.  
> B. Have `executeAgentSessionWith` throw a typed sentinel error when `exhausted`, letting
>    `classifyThrown` handle it as `HARD_FAILURE`.
>
> **Option B is preferred** because it keeps `classify.ts` unmodified and the sentinel error
> message becomes the `HARD_FAILURE` reason. Implementation detail: the sentinel is a plain
> `Error("empty assistant output after N read attempt(s)")` thrown inside the `try` block of
> `executeAgentSessionWith`, which `createSessionError` will wrap normally. The `classifySpawnError`
> call in `classifyThrown` sees `thrown=Error, httpStatus=null, assistantText=undefined` and
> classifies it as `HARD_FAILURE` with reason = the error message.

### `src/tools/resume-subagent.ts` (modified)

**Change surface:** `resumeSession` only. Mirror the same guard after the `session.messages` call,
using the same `readAssistantTextWithRetry` helper. On exhaustion, throw a sentinel error so the
existing `catch` block in `resumeSession` classifies it as `HARD_FAILURE` with an informative reason.

### Config (`src/utils/config.ts` or equivalent config file)

New section under `subagent`:

```typescript
readGuard: {
  maxExtraReads: 2,          // 2 extra reads = 3 total attempts
  backoffMs: [200, 500],     // ms between attempts
}
```

Config is read at call time; no restart required (stateless read).

---

## Data Flow

### Happy path (output present on first read)

```
prompt() → messages() → readAssistantText() → non-empty
  → readAssistantTextWithRetry: extraReads=0, exhausted=false
  → output = <actual text>
  → classifySpawnError({ assistantText: output })
  → SUCCESS or marker-based class (unchanged)
```

### Re-read recovery path (output empty on first read, present on re-read)

```
prompt() → messages() → readAssistantText() → ""
  → readAssistantTextWithRetry: sleep(200ms) → messages() → non-empty
  → extraReads=1, exhausted=false
  → output = <actual text>
  → classifySpawnError({ assistantText: output })
  → SUCCESS or marker-based class (unchanged)
```

### Exhausted path (all reads return empty)

```
prompt() → messages() → readAssistantText() → "" (× 3)
  → readAssistantTextWithRetry: exhausted=true
  → throw new Error("empty assistant output after 3 read attempt(s)")
  → caught by executeAgentSessionWith try/catch
  → createSessionError(error, sessionId)
  → classifyThrown → classifySpawnError({ thrown: Error, httpStatus: null })
  → HARD_FAILURE, reason = "empty assistant output after 3 read attempt(s)"
  → AttemptResult: class=HARD_FAILURE, value.error = reason
  → finalizeSettled → cleanupSession → createHardFailureResult
  → SpawnResult: outcome=hard_failure, error="empty assistant output after 3 read attempt(s)"
```

### Throw during re-read (messages API throws)

```
  → readAssistantTextWithRetry propagates the throw
  → caught by executeAgentSessionWith try/catch (unchanged path)
  → classifyThrown handles it as before (transient / hard_failure)
```

---

## Error Handling

| Scenario | Before this change | After this change |
|---|---|---|
| Messages API returns empty on first call, non-empty on re-read | `HARD_FAILURE: "empty response"` | `SUCCESS` (or marker class) |
| Messages API returns empty on all `N+1` reads | `HARD_FAILURE: "empty response"` | `HARD_FAILURE: "empty assistant output after N+1 read attempt(s)"` |
| Messages API throws during re-read | n/a (only one read existed) | Propagates to `classifyThrown`, classified as before |
| Messages API returns non-empty on first read | `SUCCESS` (unchanged) | `SUCCESS` (unchanged, zero overhead) |
| Transient network error on `session.prompt` | `TRANSIENT` → `retryOnTransient` | Unchanged (separate concern) |

The sentinel error message format is intentionally machine-readable:
`"empty assistant output after {N} read attempt(s)"`. Tests and monitoring can key on this prefix.

---

## Testing Strategy

### Unit tests — `tests/tools/spawn-agent/read-guard.test.ts` (new file)

| Test | Expected |
|---|---|
| `firstOutput` non-empty → returns immediately, `extraReads=0` | PASS |
| `firstOutput` empty, first re-read non-empty → `extraReads=1, exhausted=false` | PASS |
| `firstOutput` empty, all re-reads empty → `exhausted=true, output=""` | PASS |
| `firstOutput` empty, re-read throws → error propagates | PASS |
| `backoffMs` array shorter than `maxExtraReads` → uses last value for overflow | PASS |
| `maxExtraReads=0` → no re-reads, returns empty immediately | PASS |

### Integration tests — `tests/tools/spawn-agent/tool.test.ts` (extended)

Add a `createCtxWithEmptyThenFilled` helper that mocks `session.messages` to return `[]` on the
first call, then the real output on the second call. Assert that the `SpawnResult` outcome is
`success` and the output matches the filled value.

Add a `createCtxWithAlwaysEmpty` helper (all `messages` calls return `[]`). Assert that the
`SpawnResult` outcome is `hard_failure` and the error string contains
`"empty assistant output after"`.

### Unit tests — `tests/tools/spawn-agent/classify.test.ts` (no change needed)

`classify.ts` is not modified; its existing tests must continue to pass as-is.

### Resume path — `tests/tools/resume-subagent.test.ts` (extended or new)

Mirror the same two integration scenarios for `resumeSession` in `resume-subagent.ts`.

### Config — no new test needed

Config is read-only and uses defaults; the new keys are validated by TypeScript types.

---

## Open Questions

1. **Should `maxExtraReads` be per-agent-type?** Some agents (e.g., long-running `executor`)
   may need more re-reads than short `codebase-locator` tasks. For now, a single global default
   is chosen (minimal scope); per-agent override can be added later if data shows need.

2. **Should `extraReads > 0` be surfaced in the `diagnostics` field of `SpawnResult`?**
   This would help coordinators distinguish first-read successes from recovered-on-re-read
   successes. Not included in this design to keep scope minimal, but low-cost to add in
   implementation.

3. **Does `resume-subagent.ts` also need the `messages` query `directory` parameter?**
   The current `resumeSession` call passes no `query` parameter (see line 143). If the guard's
   re-read call must match, it should also omit the `directory`. Implementation must confirm this
   before coding.

4. **Is the 200 ms / 500 ms backoff empirically validated?** The values are conservative
   estimates. If telemetry after rollout shows that re-reads always resolve within 50 ms or
   require > 1 s, the config defaults should be tuned. No service restart is needed to change
   config defaults post-deploy.
