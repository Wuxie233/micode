---
date: 2026-04-29
topic: "Agent-owned conversation titles"
status: validated
---

# Agent-owned conversation titles

## Problem Statement

The current conversation-title fallback is too eager. When no stronger lifecycle or tool milestone signal exists, ordinary chat text can become the OpenCode conversation title.

That makes titles feel like copied prompts instead of intelligent task labels. Messages such as restart confirmations, follow-up questions, or corrections should not rename the conversation.

## Constraints

- Do not solve this by growing a low-information phrase list.
- Do not make the title hook guess user intent with broad heuristics.
- Keep lifecycle and tool milestone signals working as strong title sources.
- Preserve opt-out, throttling, done freeze, max length, and internal-session skipping.
- Keep OpenCode native titles untouched when micode has no strong title signal.

## Approach

Move semantic title ownership out of the generic chat fallback.

The conversation-title hook should only write titles from strong signals: lifecycle summaries, plan/design paths, commit summaries, finish events, and future explicit agent semantic title events. Ordinary chat messages should not directly become titles by default.

This keeps the service as a persistence and safety layer rather than a semantic guesser.

## Architecture

The title system has three responsibilities:

- **Agent semantic ownership:** agents provide meaningful task labels when they intentionally enter a task workflow.
- **Lifecycle status ownership:** lifecycle and milestone events provide phase changes such as planning, executing, and done.
- **Title service persistence:** the hook writes titles to OpenCode and protects user intent through opt-out, throttling, and freeze behavior.

The chat message hook no longer acts as an automatic source of semantic truth.

## Components

**Conversation title hook:** Keeps tool milestone handling and session cleanup. Chat message handling becomes disabled by default or limited to explicit opt-in compatibility mode.

**Title state registry:** Remains the central decision engine for source priority, opt-out, throttle, and done freeze. It should not need to infer semantic intent from raw chat text.

**Tool milestone classifier:** Remains responsible for lifecycle and workflow signals. These signals are explicit enough to update titles safely.

**Configuration:** Exposes the chat fallback behavior as an opt-in compatibility choice if needed, with the default set to no chat fallback.

## Data Flow

**Strong signal flow:**

- A lifecycle or tool milestone completes.
- The classifier extracts status, summary, and source.
- The hook fetches the current session title for opt-out detection.
- The registry decides whether to write, skip, throttle, or freeze.
- The hook writes the formatted title to OpenCode.

**Ordinary chat flow:**

- A normal chat message arrives.
- If chat fallback is disabled, no title decision is made.
- Existing OpenCode or user-set title remains untouched.

**Manual title flow:**

- If the user manually changes the title after a confirmed system write, opt-out remains sticky.
- Later milestone events do not overwrite that title.

## Error Handling

Title update failures remain non-fatal. The hook logs and returns without disrupting the agent conversation.

Disabling chat fallback should be safe by construction: skipping a weak title source is preferable to writing misleading titles. Strong milestone events continue to update titles when available.

## Testing Strategy

- Add tests proving ordinary chat messages do not write titles when chat fallback is disabled by default.
- Add tests proving lifecycle/tool milestone titles still write normally.
- Add tests proving opt-in compatibility mode can keep the old chat fallback behavior if the config exposes it.
- Add scenario coverage for short status replies such as restart confirmations not changing titles.
- Keep existing opt-out, throttle, done freeze, and lifecycle status tests passing.

## Open Questions

Future work can add an explicit agent semantic title signal. That should be a deliberate agent-owned event, not raw chat fallback inference.
