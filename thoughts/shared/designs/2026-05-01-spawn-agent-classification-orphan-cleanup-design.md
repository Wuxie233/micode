---
date: 2026-05-01
topic: "Spawn Agent Classification and Orphan Cleanup"
status: validated
---

# Spawn Agent Classification and Orphan Cleanup

## Problem Statement

We are fixing two production failures in the nested subagent workflow.

First, `spawn_agent` can classify a successful subagent as `task_error` or `blocked` because the current classifier uses plain text marker matching. A successful reviewer or executor can mention `TEST FAILED`, `BUILD FAILED`, or `CHANGES REQUESTED` as analysis text, and the parent treats that as a real failed outcome. That preserved session then stays visible as `失败: ...` instead of being deleted.

Second, nested dispatch has no parent-run cleanup or fencing. A main agent can start an `executor`, the executor can spawn many implementer or reviewer subagents, then the executor can crash or disconnect while those children keep running. If the main agent starts a new executor, both executor generations can run duplicate child work at the same time.

## Constraints

- Keep `spawn_agent` public results compatible: `success`, `task_error`, `blocked`, and `hard_failure` remain the externally visible outcomes.
- Preserve the existing `resume_subagent` path for genuine `task_error` and `blocked` sessions.
- Do not route every classification through an LLM. Clear fast paths must stay deterministic and cheap.
- Cleanup must be best-effort. Failed deletion should log diagnostics but must not turn a successful task into a failed task.
- Nested executor recovery must avoid duplicate work without relying on the executor LLM remembering prior state.
- Reuse existing project patterns: TTL registries, parent-scoped cleanup, internal session delete retry, and ownership fences.

## Approach

The chosen approach is a two-part infrastructure fix.

**Part 1: two-stage classification.** Keep deterministic rules for clear outcomes, but add LLM-assisted verification only when the rule classifier sees a failure or blocked marker inside otherwise valid assistant output. The verifier decides whether the marker is a real final status or merely text being discussed.

**Part 2: spawned-session lifecycle ownership.** Track every child session created by `spawn_agent` with an owner session, parent run, generation, status, and task identity. Use that registry to clean up children when a parent executor generation fails, and to fence stale generations so a re-dispatched executor cannot run the same logical work twice without noticing the prior generation.

I considered a pure LLM classifier, but rejected it because `spawn_agent` is infrastructure. It needs deterministic fast paths for normal success, SDK failures, and transient errors. I also considered only tightening marker regexes, but that would still fail whenever a subagent naturally quotes the exact marker in a successful analysis.

## Architecture

The design adds a narrow classification verification layer and a broader child-session lifecycle registry.

**Classification layer:**

- Existing rule classifier remains the first pass.
- Marker hits become “needs verification” instead of immediately authoritative when assistant text is otherwise present.
- The verifier produces a structured decision with outcome, confidence, and reason.
- Low-confidence verification falls back to the safer outcome for user workflow: do not preserve as failed unless the output clearly asks for resume or escalation.

**Lifecycle registry:**

- `spawn_agent` records each child when it creates an internal session.
- Each record includes ownership and generation metadata.
- Success and hard failure still delete child sessions and remove registry records.
- Genuine `task_error` and `blocked` records remain preserved for `resume_subagent`.
- Parent cleanup can mark a generation aborted and best-effort delete non-preserved children.

**Executor fencing:**

- Each executor dispatch generation gets a stable run identity.
- Each spawned task gets a logical task identity derived from plan path, batch, task id, role, and target file when available.
- A new executor generation checks the registry for active children from older generations with the same logical identity.
- If old children are still running, the new generation either skips, resumes, or waits based on the recorded status instead of blindly duplicating the task.

## Components

**Spawn outcome classifier:** decides the initial rule-based class and reason. It should become more conservative about treating text markers as final outcomes.

**LLM verification adapter:** performs a small, isolated classification call for ambiguous marker-hit assistant text. It must be stateless and must not append messages to the child session being classified.

**Spawn session registry:** tracks created child sessions, owner session, parent run, generation, task identity, current status, creation time, and preservation state.

**Parent cleanup service:** deletes or marks stale child sessions when a parent run fails, is interrupted, or is superseded by a newer executor generation.

**Generation fence:** prevents duplicate logical tasks from being launched across overlapping executor generations.

**Diagnostics formatter:** includes classification reason, verifier reason, and cleanup outcome in spawn-agent output and logs without exposing secrets or huge transcripts.

## Data Flow

**Normal successful child:**

1. Executor calls `spawn_agent` with one or more child tasks.
2. `spawn_agent` creates an internal session and records it in the registry as running.
3. The child returns assistant output.
4. Rule classification returns clear success, or marker verification upgrades an ambiguous marker hit back to success.
5. `spawn_agent` deletes the internal child session and removes the registry record.

**Genuine failed child:**

1. Child output includes a clear final failure or blocked status.
2. Rule classification or verifier confirms `task_error` or `blocked`.
3. The session title is updated to `失败:` or `阻塞:`.
4. The record is preserved with resume metadata.
5. `resume_subagent` can recover it later and delete it on successful recovery.

**Executor crash and re-dispatch:**

1. Executor generation A launches child sessions.
2. Executor generation A fails or disconnects before collecting all results.
3. Registry records still show active children owned by generation A.
4. Main agent launches executor generation B.
5. Generation B checks for active or preserved records with matching logical task identities.
6. Generation B avoids duplicate launches and either waits for, skips, resumes, or reports stale work based on the registry state.

## Error Handling

Classification failures should fail open toward workflow continuity.

- If LLM verification is unavailable, the strict marker rules still apply, but only clear final-status markers should preserve a session.
- If verification returns malformed output, treat it as low confidence and include a diagnostic reason.
- If cleanup deletion fails, retry using existing internal-session backoff behavior and log the orphan record.
- If registry state is stale, TTL sweep removes expired non-preserved records.
- If a duplicate generation cannot safely decide whether to skip or resume, it should report a blocked orchestration state rather than silently launching duplicate work.

## Testing Strategy

Tests should cover behavior, not implementation details.

- Classification tests where successful text mentions `TEST FAILED`, `BUILD FAILED`, `CHANGES REQUESTED`, `BLOCKED:`, or `ESCALATE:` without being a final status.
- Classification tests where final explicit blocked or task-error output remains preserved.
- Verifier fallback tests for unavailable, malformed, and low-confidence verifier responses.
- Registry tests for child creation, success deletion, preserved failure, parent cleanup, TTL sweep, and ownership boundaries.
- Executor-generation tests where generation B does not duplicate active generation A child tasks.
- Cleanup tests proving delete failures are logged and do not change successful spawn results.

## Open Questions

- Whether OpenCode exposes a reliable parent session termination event for executor subagents specifically, or whether micode must infer parent interruption from spawn-agent failures and generation supersession.
- Whether task identity should initially be explicit in executor prompts or inferred from description text. I prefer adding explicit identity metadata because inferred text identity is fragile.
- Whether active old-generation children should be cancelled immediately or allowed to finish and be harvested. I prefer cancelling only when safe, and using generation fencing first to prevent duplicate writes.
