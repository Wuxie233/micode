---
date: 2026-05-01
topic: "QQ Completion Notifications"
status: validated
---

## Problem Statement

Users usually leave the chat after submitting a request and only return when they manually notice the AI has finished. That wastes attention because micode currently has no out-of-band completion signal.

We need a QQ notification path using the existing autoinfo MCP capability so users are told when work is done, blocked, or stopped by a failure that needs attention.

## Constraints

- Use `autoinfo_send_qq_notification` as the delivery mechanism.
- Default to private QQ user `445714414` unless configuration overrides it.
- Notifications are best-effort: delivery failure must never fail the user task, lifecycle finish, commits, merges, or final response.
- Notify only meaningful terminal states: completed, blocked, or failed-stop.
- Do not notify intermediate workflow phases such as design completion, plan creation, individual executor batches, or reviewer cycles.
- Keep messages short and sanitized: no secrets, tokens, large logs, raw transcripts, or sensitive environment details.
- Preserve the existing v9 lifecycle flow and quick-mode behavior.

## Approach

The chosen approach is a unified completion notification layer with an agent-level fallback.

**Primary path:** lifecycle-aware completion notification fires when micode reaches a terminal workflow state. This gives us reliable completion semantics and avoids relying only on prompt discipline.

**Fallback path:** primary agents explicitly notify at the end of quick-mode or non-lifecycle tasks. This covers small requests that intentionally skip the issue-driven lifecycle.

I considered a prompt-only solution and rejected it because it is too easy for agents to forget, especially in blocked or error flows. I also considered only wiring `lifecycle_finish`, but that would miss quick tasks and non-lifecycle work.

## Architecture

The design introduces a small notification boundary that sits beside the workflow, not inside the core success path.

**Notification boundary:** responsible for deciding whether a terminal state deserves a QQ message, preparing a sanitized summary, deduplicating by task/session, and invoking autoinfo.

**Lifecycle integration:** detects completed lifecycle work after finish is confirmed, and detects blocked or failed-stop states when execution cannot continue.

**Agent fallback:** primary agents use the same policy for quick-mode completion so notification behavior remains consistent across workflow types.

The architecture deliberately treats QQ delivery as a side effect. Core workflow state remains source-of-truth in lifecycle records, issue comments, ledgers, and final chat output.

## Components

**Completion notification policy:** decides whether to notify and which terminal status applies.

- Completed: work finished and final result is ready for user review.
- Blocked: user action is required before progress can continue.
- Failed-stop: automation stopped after an unrecoverable failure or a single-attempt lifecycle failure.

**Message composer:** builds short QQ-safe messages.

- Includes task title, status, concise summary, and review instruction.
- Includes issue or PR reference when available.
- Omits long logs, secrets, raw tool output, and noisy implementation details.

**Deduplication state:** prevents repeated notifications for the same task.

- Prefer lifecycle issue number when available.
- Fall back to session or conversation identity for quick-mode tasks.
- Allow a later completed notification after an earlier blocked notification if the task resumes and succeeds.

**Delivery adapter:** calls `autoinfo_send_qq_notification` and absorbs delivery failures.

- Defaults to private QQ user `445714414`.
- Supports future group routing through configuration.
- Records failures for diagnostics without surfacing them as workflow failures.

## Data Flow

For lifecycle work:

1. User request is accepted and lifecycle issue/worktree are created.
2. Design, plan, and executor phases run as usual.
3. Executor reports a terminal outcome.
4. If all work is green, lifecycle finish runs first.
5. After completion is confirmed, notification policy emits a completed QQ message.
6. If executor reports blocked work, notification policy emits a blocked QQ message and lifecycle remains in progress.
7. If lifecycle or execution stops on an unrecoverable failure, notification policy emits a failed-stop QQ message.

For quick-mode work:

1. Agent completes the scoped request without lifecycle.
2. Before final chat response, agent fallback invokes the same notification policy.
3. Deduplication ensures only one terminal notification is sent.

## Error Handling

Notification delivery must be isolated from the core workflow.

**Autoinfo unavailable:** skip QQ delivery, record a diagnostic note, and continue final reporting.

**QQ send failure:** absorb the error, avoid repeated retries, and do not mark the user task as failed.

**Duplicate trigger:** deduplication suppresses repeated sends for the same terminal state.

**Missing task metadata:** send a generic but useful message with status and instruction to return to OpenCode.

**Sensitive content risk:** composer uses short summaries and known-safe links instead of raw logs or tool output.

## Testing Strategy

Tests should verify behavior, not implementation details.

**Policy tests:** completed, blocked, failed-stop, disabled notification, and duplicate suppression.

**Message tests:** private target default, optional group routing, sanitized summary, and safe fallback when title or links are missing.

**Delivery tests:** autoinfo success, autoinfo failure, missing MCP tool, and no workflow failure propagation.

**Workflow tests:** lifecycle success sends once after finish, blocked sends once without finish, quick-mode completion sends once, and intermediate phases do not notify.

## Open Questions

- Whether to expose a user-facing configuration option for minimum task duration before notifying. The approved default is to notify all terminal tasks.
- Whether group notification should be supported immediately or left as a configuration-only extension point. The approved default is private QQ only.
- Whether notification diagnostics should appear in final chat output or remain internal. The recommended default is internal unless delivery failure itself becomes relevant to debugging.
