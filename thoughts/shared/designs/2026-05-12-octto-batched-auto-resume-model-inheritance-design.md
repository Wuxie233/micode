---
date: 2026-05-12
topic: "Octto batched auto-resume and model inheritance"
status: validated
---

# Octto batched auto-resume and model inheritance

## Problem Statement

Octto currently lets the browser collect several drafted answers, but when the user clicks the send button each answer is submitted as an independent response event. Each event triggers its own auto-resume prompt back into the owner OpenCode conversation.

That creates two visible problems: one user action can produce several continuation messages, and the resumed prompt may run under a different default model instead of the model the original conversation last used.

## Constraints

- This is workflow/runtime-sensitive and must stay on the lifecycle + planner + executor path.
- Preserve the existing Octto answer retrieval contract: agents still retrieve answers through Octto tools instead of receiving raw answer content in the resume prompt.
- Keep the existing browser/WebSocket response protocol unless a minimal compatible adjustment is clearly required.
- Model inheritance is best-effort: if model metadata cannot be determined, Octto must degrade to the current no-explicit-model behavior instead of failing the resume.
- The change should remain scoped to Octto auto-resume/session prompt boundaries and avoid broad plugin refactors.

## Approach

Use the auto-resume dispatcher as the coalescing boundary. When several answer events arrive for the same owner conversation in a short burst, the dispatcher groups them and sends exactly one continuation prompt after a short quiet window.

The continuation prompt should carry the owner conversation's last-used model when that can be read from session message metadata. The model source of truth is the original OpenCode owner session history, not the Octto browser state.

I considered changing the browser/WebSocket protocol to submit an array of answers, but rejected it because it widens the protocol and test surface unnecessarily. The server already sees every answer event, so batching at auto-resume solves the user-visible issue with less coupling.

## Architecture

The design keeps Octto's existing layers intact:

- **Octto UI** continues to draft answers locally and send response messages when the user clicks the send button.
- **Session store** continues to record each answer independently and wake waiting `get_answer` / `get_next_answer` calls.
- **Auto-resume dispatcher** becomes responsible for coalescing answer notifications before prompting the owner OpenCode session.
- **OpenCode client adapter** becomes responsible for allowing the dispatcher to include an optional model in the prompt body.
- **Model resolver** reads owner session message metadata and returns a best-effort provider/model reference for the prompt.

The key boundary is that batching affects only the number of continuation prompts. It does not merge answer records or change how answers are consumed.

## Components

**Auto-resume batch queue:** Tracks pending answered question IDs per Octto session and owner session. It schedules a short flush timer and replaces repeated immediate prompt sends with one grouped dispatch.

**Flush policy:** Uses a short quiet window so the burst produced by one browser click becomes one resume message. Separate user sends outside that window naturally produce separate continuation messages.

**Model lookup helper:** Queries the owner OpenCode session messages and extracts the most recent usable model metadata, prioritizing assistant messages because they represent the last actual model execution.

**Prompt request builder:** Builds a single continuation prompt that tells the agent how many answers are ready and instructs it to drain available answers through Octto tools.

**Client prompt adapter:** Passes through optional model metadata to `client.session.prompt` instead of stripping the request down to text-only parts.

**Tests:** Cover multi-answer batching, single-answer behavior, separated sends, model inheritance, and fallback when model lookup fails.

## Data Flow

1. User answers several pending questions in Octto and clicks the browser send button once.
2. The browser sends the existing per-answer response messages to the Octto server.
3. The session store records each answer and emits answer events as it does today.
4. The dispatcher receives each event and appends it to the pending batch for the owner session.
5. The dispatcher waits for the quiet window to expire, then flushes the batch once.
6. During flush, it resolves the owner conversation's latest model metadata if available.
7. The dispatcher sends one continuation prompt to the owner OpenCode session, including the model reference when resolved.
8. The resumed agent calls Octto answer retrieval tools and processes all available answers.

## Error Handling

- Missing owner registration remains a no-op; no prompt is sent.
- Prompt send failures remain warning-level and do not break Octto answer persistence.
- Model lookup failures are swallowed into a no-model fallback so answer delivery continues.
- If a new answer arrives while a flush is pending, it joins the current batch.
- If a new answer arrives after a batch flushed, it starts a new batch and produces a later continuation prompt.
- If a flush fails, the design does not retry indefinitely; existing warning behavior is preserved to avoid duplicate resumes.

## Testing Strategy

- Unit-test the dispatcher so multiple answer events in the same burst produce one prompt call.
- Unit-test the dispatcher so one answer still produces one prompt call.
- Unit-test separated answer events so independent sends are not incorrectly merged.
- Unit-test prompt body construction with an inherited model reference.
- Unit-test model lookup fallback so no model metadata still sends a valid prompt.
- Keep existing Octto persistence and forbidden cross-conversation tests passing.

## Open Questions

- The quiet window should start at 200ms. If tests show timer flakiness, planner may choose a dependency-injected scheduler or explicit flush helper for deterministic coverage.
- Exact message wording can be adjusted by planner/executor, but it must preserve the contract that answers are read from Octto tools rather than embedded directly in the prompt.
