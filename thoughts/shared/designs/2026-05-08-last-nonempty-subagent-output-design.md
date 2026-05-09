---
date: 2026-05-08
topic: last-nonempty-subagent-output-extraction
status: validated
issue: 59
---

# Correct Subagent Result Extraction to Use Last Non-Empty Assistant Text

## Problem Statement

All three result-extraction sites currently use the same one-liner to pull assistant output from a
completed session:

```typescript
messages.filter((m) => m.info?.role === "assistant").pop()
```

This collects all assistant messages and blindly pops the **last** one. It is the bug.

### Why `.pop()` is wrong

A subagent session can finish with a **terminal empty/tool-call-only assistant message** appended
after the real substantive output. Common causes:

- The model emits one or more tool-call parts (no `text` content) as a trailing assistant turn.
- The model emits a whitespace-only assistant message (e.g. a stray newline) after completing its
  prose output.
- The model streams a partial empty message before the API reports completion.

In all these cases, the `.pop()` lands on the terminal empty message, `readAssistantText` returns
`""`, and the caller proceeds as if the subagent produced no output at all — even though one or
more earlier assistant messages contain the real text.

### Bug locations

| File | Line | Pattern |
|---|---|---|
| `src/tools/spawn-agent/tool.ts` | 247 | `messages.filter(role=assistant).pop()` |
| `src/tools/resume-subagent.ts` | 72 | `messages.filter(role=assistant).pop()` |

Both copies are identical. The `verifier.ts` receives its input (`assistantText`) from the spawn
path's extraction — it does not call `readAssistantText` itself, but it inherits the wrong value
when the spawn path mislabels an empty extraction as the real output.

### Relationship to issue #55 (read-guard)

Issue #55 added `readAssistantTextWithRetry` (read-guard) to defend against a **timing race**:
the messages API returns an empty list because the model has not finished streaming yet. The
read-guard re-reads up to `N` times and returns the first non-empty result.

Issue #59 is an **orthogonal bug**: the messages API has returned a full list, but the last
assistant message in that list is a non-text (tool-call-only) or whitespace-only message, so
`readAssistantText` returns `""` on every re-read. The read-guard then exhausts its retries and
raises a hard-failure, **losing** the valid text that existed in an earlier assistant message all
along.

The #55 read-guard must be preserved as a fallback for timing races; the #59 fix must happen
**inside** the `readAssistantText` function, before the guard is invoked.

---

## Constraints

- **No Atlas change.** Do not reduce or disable Atlas auto-inject. Issue #59 is scoped strictly to
  the assistant-text extraction function.
- **No OpenCode restart during implementation.** The fix must not require a service restart.
- **Preserve the #55 read-guard.** `readAssistantTextWithRetry` in `read-guard.ts` stays intact.
  The new extraction logic sits inside `readAssistantText`, which is called by both the first-read
  and each re-read inside the guard. The guard continues to handle the timing-race case.
- **Consistent semantics across all three call sites.** `spawn-agent/tool.ts`,
  `resume-subagent.ts`, and the verifier path must all benefit from the fix. Because the verifier
  receives `assistantText` from the spawn path's extraction, fixing the extraction in both
  `tool.ts` and `resume-subagent.ts` automatically fixes the verifier's input.
- **Shared helper, low coupling.** The extraction fix should live in one place. The two copies of
  `readAssistantText` (in `tool.ts` and `resume-subagent.ts`) should be collapsed into a shared
  helper so the logic cannot drift.
- **No broad refactor.** Touch only the extraction function and its two call sites. Do not alter
  `classify.ts`, `read-guard.ts`, `verifier.ts`, `retry.ts`, `generation-fence.ts`, or any other
  file.
- **No new external dependencies.**

---

## Approach

Replace the current `messages.filter(role=assistant).pop()` pattern with a
**reverse-scan** that walks the assistant messages from **newest to oldest**, skipping any message
that has no extractable text content, and returns the text of the first message that does.

An assistant message is considered non-empty (text-bearing) if and only if it has at least one
`part` with `type === "text"` and a non-empty `text` field after trimming.

A message is **skipped** (classified as terminal/non-substantive) when:
- It has no `parts` at all, or
- All of its parts have `type !== "text"`, or
- All text parts have empty/whitespace-only `text`.

This approach:
- Requires **zero protocol changes** — the `SessionMessage` shape is unchanged.
- Has **zero overhead** on the happy path: if the last assistant message already has text, the
  scan returns on the first iteration.
- Is **transparent to the read-guard**: `readAssistantText` returns `""` only when **all**
  assistant messages are non-text, which is the genuine hard-failure case.  The read-guard
  can then re-read, which may retrieve a later (now non-empty) list — preserving the #55 defence.
- Is **transparent to `classifySpawnError`**: the classification input shape is unchanged.

---

## Architecture

```
spawn-agent/tool.ts
│
├── readAssistantText()             ← MODIFIED: reverse-scan instead of .pop()
│   └── now shared via import from read-guard.ts (or a new shared module)
│
├── readSessionAssistantText()      ← no change (calls readAssistantText)
├── readGuardedAssistantOutput()    ← no change (calls readSessionAssistantText + guard)
└── executeAgentSessionWith()       ← no change

resume-subagent.ts
│
├── readAssistantText()             ← REMOVED: local duplicate
└── resumeSession()
    └── now calls shared readAssistantText from read-guard.ts (or new shared module)

verifier.ts                         ← no change
classify.ts                         ← no change
read-guard.ts                       ← receives new readAssistantText export (or no change if
                                       shared module is separate)
```

### Shared helper placement

Two options:

**Option A — Export from `read-guard.ts`** (preferred)  
Add `readAssistantText` as a named export from `src/tools/spawn-agent/read-guard.ts`. Both
`tool.ts` and `resume-subagent.ts` already import from this module (`readAssistantTextWithRetry`).
Adding a second export keeps the coupling surface identical to what it is today and avoids
creating a new file.

**Option B — New `src/tools/spawn-agent/message-utils.ts`**  
Extract to a dedicated module. Slightly cleaner semantic boundary (extraction ≠ retry guard),
but requires a new file and two new import lines. Acceptable if the reviewer prefers it.

Recommendation: **Option A** — minimal diff, no new module, both callers already import from
`read-guard.ts`.

---

## Components

### `src/tools/spawn-agent/read-guard.ts` (modified — new export)

**New export:**

```typescript
/**
 * Returns the concatenated text of the latest assistant message that has
 * at least one non-empty text part, scanning from newest to oldest.
 * Returns "" only when no assistant message with text content exists.
 */
export function readAssistantText(messages: readonly SessionMessage[]): string {
  // Walk from newest to oldest assistant message.
  const assistantMessages = messages.filter((m) => m.info?.role === "assistant");
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const msg = assistantMessages[i];
    const textParts = msg.parts?.filter((p) => p.type === "text" && p.text?.trim()) ?? [];
    if (textParts.length > 0) {
      return textParts.map((p) => p.text).join("\n");
    }
  }
  return "";
}
```

The `SessionMessage` interface type (currently inlined in both `tool.ts` and `resume-subagent.ts`)
must be co-located with the export or imported where it is defined. Since both files already
define identical `SessionMessage` shapes locally, the cleanest approach is to define the canonical
interface once inside `read-guard.ts` and have both callers import it from there (or rely on
structural typing and keep the local definitions — both are valid TypeScript).

### `src/tools/spawn-agent/tool.ts` (modified)

- **Remove** the local `readAssistantText` function (lines 246–254).
- **Add** `readAssistantText` to the existing import from `./read-guard`.
- No other changes. All call sites (`readSessionAssistantText` at line 294) continue to call the
  same function name; only the implementation changes.

### `src/tools/resume-subagent.ts` (modified)

- **Remove** the local `readAssistantText` function (lines 71–79).
- **Add** `readAssistantText` to the existing import from `./spawn-agent/read-guard`.
- No other changes. `resumeSession` (line 150) calls `readAssistantText` identically.

### `src/tools/spawn-agent/verifier.ts` — no change

The verifier receives `assistantText` from `settled.value.output` which is set by the spawn path.
Once the spawn path's extraction is fixed, the verifier automatically receives the correct text.
No direct change needed.

---

## Data Flow

### Before fix — terminal empty message loses real output

```
session.messages() → [
  { role: "assistant", parts: [{ type: "text", text: "## Result\n..." }] },   ← real text
  { role: "assistant", parts: [{ type: "tool_call", ... }] },                ← terminal, no text
]

readAssistantText (OLD):
  .filter(role=assistant).pop()     → picks terminal tool-call message
  .parts.filter(type=text)          → []
  .join("\n")                       → ""

readGuardedAssistantOutput:
  firstOutput = ""
  → read-guard fires: sleep → re-read → "" (same messages, same bug)
  → exhausted → throw Error("empty assistant output after 3 read attempt(s)")
  → HARD_FAILURE
```

### After fix — reverse-scan finds real text

```
session.messages() → [
  { role: "assistant", parts: [{ type: "text", text: "## Result\n..." }] },   ← real text
  { role: "assistant", parts: [{ type: "tool_call", ... }] },                ← terminal, no text
]

readAssistantText (NEW):
  assistantMessages = [msg0, msg1]
  i=1: msg1.parts has no text parts → skip
  i=0: msg0.parts has text parts    → return "## Result\n..."

readGuardedAssistantOutput:
  firstOutput = "## Result\n..."    → non-empty
  read-guard: extraReads=0, exhausted=false (fast-path, no retry)
  output = "## Result\n..."
  → classifySpawnError({ assistantText: "## Result\n..." }) → SUCCESS
```

### Read-guard still fires on true timing race (no regression to #55)

```
session.messages() → []   (model not finished streaming)

readAssistantText (NEW):
  assistantMessages = []
  loop: no iterations
  return ""

readGuardedAssistantOutput:
  firstOutput = ""
  → read-guard fires: sleep → re-read → eventually non-empty → recovered
```

---

## Error Handling

| Scenario | Before fix (#59) | After fix |
|---|---|---|
| Last assistant message is tool-call-only; earlier message has text | `HARD_FAILURE: "empty response"` | `SUCCESS` (or marker-classified) |
| Last assistant message is whitespace-only; earlier message has text | `HARD_FAILURE: "empty response"` | `SUCCESS` (or marker-classified) |
| All assistant messages are non-text (genuine empty) | `HARD_FAILURE` (via guard exhaustion) | `HARD_FAILURE` (guard exhaustion unchanged) |
| No assistant messages at all (timing race) | `HARD_FAILURE` (via guard exhaustion or timing luck) | Guard fires, same as before (#55 unchanged) |
| Last assistant message has valid text (happy path) | `SUCCESS` | `SUCCESS` (zero-iteration fast-path, no overhead) |
| Verifier receives text extracted from tool-call-only last message | Receives `""` — may falsely fallback | Receives real text — classifies correctly |

The `EMPTY_OUTPUT_REASON_PREFIX` constant and `buildEmptyReadReason` in both `tool.ts` and
`resume-subagent.ts` are unchanged; they remain the sentinel for the truly-empty hard-failure case.

---

## Testing Strategy

### Unit tests — `tests/tools/spawn-agent/read-guard.test.ts` (extended, same file as #55 tests)

| Test | Expected |
|---|---|
| Messages: one assistant with text → returns text | PASS |
| Messages: last assistant is tool-call-only, prior has text → returns prior text | PASS |
| Messages: last assistant is whitespace-only, prior has text → returns prior text | PASS |
| Messages: multiple tool-call-only assistants before a text one → returns the text one | PASS |
| Messages: all assistants are non-text → returns `""` | PASS |
| Messages: no assistant messages at all → returns `""` | PASS |
| Messages: last assistant has multiple text parts → all joined with `"\n"` | PASS |
| Messages: mixed roles (user/assistant interleaved), last assistant is tool-call-only → returns earlier assistant text | PASS |

### Integration tests — `tests/tools/spawn-agent/tool.test.ts` (extended)

Add `createCtxWithTrailingToolCall` helper: `session.messages` returns a list where the last
assistant message has only a `tool_call` part and the second-to-last assistant message has real
text. Assert that `SpawnResult.outcome === "success"` and `SpawnResult.output` matches the text.

Add `createCtxWithTrailingWhitespace` helper: last assistant message has `{ type: "text", text: "  " }`.
Assert same success behaviour.

Both new helpers must pass without touching the read-guard config (i.e. `extraReads` remains 0,
proving the fix happens before the guard, not inside it).

### Resume path — `tests/tools/resume-subagent.test.ts` (extended)

Mirror the same two scenarios (trailing tool-call, trailing whitespace) for `resumeSession`.

### Verifier path — `tests/tools/spawn-agent/verifier.test.ts` (no change needed)

The verifier unit tests operate on `assistantText` directly; they are agnostic to extraction.
No new verifier tests required. The existing tests must pass unchanged.

### Regression — existing tests must pass

All existing tests in `read-guard.test.ts`, `tool.test.ts`, `classify.test.ts`,
`resume-subagent.test.ts` must pass with zero modification. The fix is an internal change to
`readAssistantText`; no external interface changes.

---

## Open Questions

1. **Should the reverse-scan concatenate text parts from multiple non-terminal assistant
   messages, or only from one?** The current design returns text from the **single** latest
   text-bearing message (same cardinality as before, just smarter selection). Concatenating
   across multiple messages would be a different semantic change and is out of scope for #59.

2. **Should `SessionMessage` be promoted to a shared type in `read-guard.ts`?** Currently both
   `tool.ts` and `resume-subagent.ts` define identical local interfaces. Co-locating with the
   new shared `readAssistantText` export is cleaner but widens the diff. The implementation can
   rely on structural typing and leave the local interface definitions in place if the reviewer
   prefers minimal diff.

3. **Should skipped (non-text) assistant messages be logged for diagnostics?** Knowing that a
   trailing tool-call message was skipped could help future debugging. The implementation could
   add a `log.debug` call when `i < assistantMessages.length - 1` and a non-text message was
   skipped. Not required for correctness; decision deferred to implementation.

4. **Does the fix interact with the `generation-fence`?** The generation fence operates on
   `taskIdentity` derived from the prompt and description, not from assistant output. No
   interaction expected. Confirm during implementation by inspection of `evaluateFence` inputs.
