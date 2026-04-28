---
date: 2026-04-28
topic: "Fix conversation-title opt-out false positive and lifecycle_commit upstream push"
status: validated
---

# Fix conversation-title opt-out false positive and lifecycle_commit upstream push

## Problem Statement

We need to fix two workflow bugs that both come from trusting ambient state too early.

The conversation-title hook treats an OpenCode automatic initial title as a user-authored title change, so it opts out and stops managing titles. The lifecycle commit flow creates a fresh issue branch, then runs a plain push before upstream tracking exists, so the first push can fail.

## Constraints

- Keep the fix scoped to title state handling and lifecycle commit push behavior.
- Do not rely on OpenCode automatic title string formats.
- Do not rely on user or host Git configuration such as auto upstream setup.
- Preserve the current committed-but-not-pushed outcome for genuine push failures.
- Keep existing lifecycle worktree and issue branch ownership unchanged.

## Approach

Use explicit state confirmation in both places.

For conversation-title, opt-out should only be inferred after a system-written title has been observed as the current title at least once. This separates a real user edit from an early host-side automatic title race.

For lifecycle_commit, push should explicitly target origin and the lifecycle issue branch while setting upstream tracking. The lifecycle record already owns the branch identity, so the push path should not ask Git to infer it.

## Architecture

The title subsystem remains a small state machine owned by the conversation-title registry. It gains a distinction between a title that was just written by micode and a title that has been confirmed by a later session read.

The lifecycle subsystem keeps the same start, commit, and finish phases. Only the commit push command becomes explicit about remote, branch, and upstream tracking.

## Components

**Conversation title state registry:** Tracks the last system-written title, the confirmed system title state, and the opt-out flag. It decides whether a mismatch is host noise or a user edit.

**Conversation title hook:** Continues to fetch session title before write decisions. It passes current title into the registry and keeps existing handler guard behavior.

**Lifecycle commit flow:** Uses the lifecycle record branch as the branch source of truth. It pushes that branch to origin with upstream setup when auto-push is enabled.

**Lifecycle tests:** Verify behavior through runner call capture rather than implementation spies.

## Data Flow

**Conversation-title flow:**

- A title write records the system title as pending confirmation.
- A later read that matches the pending title marks it confirmed.
- A mismatch before confirmation is ignored for opt-out purposes.
- A mismatch after confirmation marks the session opted out.
- Once opted out, the session remains opted out.

**Lifecycle commit flow:**

- The lifecycle record provides worktree path and issue branch.
- Commit staging and commit creation stay unchanged.
- When push is enabled, the push command targets origin and the issue branch explicitly.
- Upstream tracking is set during that push, making later pushes deterministic.

## Error Handling

The title hook should fail soft: ambiguous early title mismatches are not treated as user opt-out, but already opted-out sessions remain protected.

The lifecycle commit flow should keep its current retained commit behavior. If the explicit push fails because of auth, network, remote, or permission issues, the tool returns the commit sha, marks pushed as false, and preserves the Git error in the note.

## Testing Strategy

- Add a title state test where OpenCode-like initial title mismatch happens before system title confirmation and does not opt out.
- Add a title state test where a mismatch after confirmed system title does opt out.
- Add a hook or scenario test to cover the first-session automatic-title race.
- Update lifecycle commit tests so first push includes upstream setup for the issue branch.
- Keep push failure tests verifying that the local commit is retained with a useful note.
- Run the full project quality gate after implementation.

## Open Questions

None. The chosen design avoids string heuristics and Git environment assumptions, so the executor can proceed directly.
