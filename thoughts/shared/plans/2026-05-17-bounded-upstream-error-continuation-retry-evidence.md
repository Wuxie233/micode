# Bounded Upstream Continuation Retry - Evidence Note

## Scope

Record whether OpenCode built-in Task / executor-direct continuation `upstream_error: Upstream request failed` is observable through the existing `src/hooks/session-recovery.ts` hook (or another hook in this repo) BEFORE any adapter code is written. This note answers design.md Open Question 1.

## Evidence Checklist

- [x] `src/hooks/session-recovery.ts` subscribes to `session.deleted`, `session.error`, and `message.updated` in its hook `event` handler. It reads `event.properties` as a record; `session.deleted` expects `properties.info.id`; `session.error` expects top-level `properties.sessionID` and `properties.error`; `message.updated` expects `properties.info.sessionID`, `properties.info.error`, and optional `properties.info.providerID`, `properties.info.modelID`, `properties.info.agent`.
- [x] `node_modules/@opencode-ai/plugin` is not installed in this task worktree, but `package.json`/`bun.lock` pin `@opencode-ai/plugin@1.14.19`. The installed package in the sibling repo imports `Event` from `@opencode-ai/sdk`, and SDK `1.14.19` defines `EventMessageUpdated` as `{ type: "message.updated"; properties: { info: Message } }`, `AssistantMessage.error`, `AssistantMessage.sessionID`, `AssistantMessage.providerID`, `AssistantMessage.modelID`, and `EventSessionError` as `{ type: "session.error"; properties: { sessionID?: string; error?: ... } }`. There is no `agent` field on `AssistantMessage`; `agent` exists on `UserMessage`.
- [x] `rg -n "Upstream request failed|upstream_error" src/` found no matches, so this repo does not explicitly emit or special-case the continuation card text. The built-in Task / executor-direct continuation card appears to be OpenCode/provider-side rather than micode code in `src/index.ts`.
- [x] Existing recovery and continuation paths all use the same OpenCode `client.session.prompt` API shape: `session-recovery.ts` prompts the same `sessionID`; `spawn-agent/tool.ts`, `resume-subagent.ts`, and `octto/auto-resume/dispatcher.ts` also prompt existing session ids. Therefore, if OpenCode emits a `session.error` or errored assistant `message.updated` for the owner/executor-direct session, `client.session.prompt({ path: { id: sessionID }, ... })` can continue that same session.
- [x] `executor-direct` is configured as an OpenCode subagent in `src/agents/index.ts` / `src/agents/executor-direct.ts`, not as a custom micode internal-session namespace. It should use the event-carried OpenCode `sessionID`; no id translation is visible in this repo.
- [x] Hook coverage is sufficient for normalized OpenCode `session.error` and errored assistant `message.updated` payloads, but not for a TUI-only continuation card if no plugin event is emitted. Downstream adapter work must implement against those two observable event shapes and treat non-emitted TUI-only cards as a documented limitation.

## Findings

OpenCode SDK event types and this repo's hook code line up on the two observable error carriers: `session.error` carries top-level `sessionID` and `error`, while `message.updated` carries `properties.info` where assistant messages include `sessionID`, `error`, `providerID`, and `modelID`. `src/hooks/session-recovery.ts` already observes both carriers and already uses `client.session.prompt({ path: { id: sessionID } })` to resume the same session. The existing handler currently reads `agent` from `info.agent`, but SDK `AssistantMessage` has no `agent` field; built-in Task / executor-direct retry should not rely on `agent` being populated from `message.updated`.

This repo contains no explicit `upstream_error` / `Upstream request failed` emission in `src/`, so the adapter cannot prove from micode source alone that the built-in Task continuation card is always exposed to plugin events. However, OpenCode SDK event definitions confirm the hook can observe normalized session/message errors when OpenCode emits them. Proceed with a bounded `session-recovery.ts` adapter for `session.error` and `message.updated` only, while documenting the limitation that a purely TUI-layer continuation card with no emitted plugin event remains unobservable.

- Decision: PROCEED with `session-recovery.ts` adapter (Task 2.1), scoped to observable `session.error` / `message.updated` events and with the TUI-only non-emission limitation preserved.

## Commands / Searches Run

- Read `src/hooks/session-recovery.ts` and confirmed `session.deleted`, `session.error`, `message.updated`, `event.properties`, `sessionID`, `error`, `providerID`, `modelID`, and recovery `client.session.prompt` usage.
- Read `src/index.ts` and confirmed `createSessionRecoveryHook(ctx)` is registered in the plugin-wide `event` pipeline.
- `rg -n "Upstream request failed|upstream_error" src/` — no matches.
- `rg -n "session\.error|message\.updated" src/hooks/` — matches in `session-recovery.ts` and other event hooks using the same `properties.info` convention.
- `rg -n "event\.type" src/hooks/session-recovery.ts` — confirmed exact event branches.
- `grep -rn "client.session.prompt" src/` equivalent via project search — found usage in `src/hooks/session-recovery.ts`, `src/tools/spawn-agent/tool.ts`, `src/tools/resume-subagent.ts`, `src/tools/octto/processor.ts`, `src/octto/auto-resume/dispatcher.ts`, and `src/index.ts`.
- Checked `package.json` / `bun.lock` for `@opencode-ai/plugin@1.14.19`; this worktree has no `node_modules/`, so inspected sibling installed package `/root/CODE/micode/node_modules/@opencode-ai/plugin/dist/index.d.ts` and `/root/CODE/micode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` for event type shapes.
- Searched `src/agents/index.ts` and read `src/agents/executor-direct.ts` to confirm `executor-direct` is an OpenCode subagent configuration, not a separate session id namespace implemented in micode.

## Limitations

- The worktree itself has no `node_modules/`, so plugin/SDK event types were verified against the same pinned version installed in the sibling repo rather than a local install under this worktree.
- No real provider failure fixture was run; this is static evidence from micode source and OpenCode SDK types.
- Provider strings such as `upstream_error: Upstream request failed` and `stream error: stream ID ...; INTERNAL_ERROR` are not present in this repo's `src/`; Task 1.2's predicate must still cover them from the design/plan vocabulary rather than local emissions.
- If OpenCode renders a continuation card purely in the TUI layer and does not emit `session.error` or `message.updated` with `info.error`, this hook cannot intercept it. Task 2.1 should not claim coverage beyond emitted plugin events.
