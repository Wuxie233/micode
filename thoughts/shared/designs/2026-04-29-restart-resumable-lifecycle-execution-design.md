---
date: 2026-04-29
topic: "Restart-resumable lifecycle execution"
status: validated
---

## Problem Statement

OpenCode restarts currently preserve durable artifacts, but they do not preserve executor progress inside an active implementation batch. When micode is updated or restarted during `spawn_agent` execution, the next primary agent can recover branch, worktree, issue, plan, and commits, but it must infer executor state from incomplete evidence.

We need restart-resumable lifecycle execution so the user can safely say "continue" after a restart and have the workflow resume from durable checkpoints instead of guessing from chat context.

## Constraints

**Non-negotiables:**

- Do not attempt to restore a subagent's private reasoning or raw transcript after restart.
- Do not blindly rerun stale dispatched tasks.
- Do not persist secrets, raw prompts, raw subagent outputs, or sensitive PTY/Octto data.
- Reuse lifecycle records and issue progress markers instead of adding an unrelated state system.
- Preserve ownership preflight before every remote mutation.
- Prefer blocking over guessing when recovery evidence is ambiguous.

**Scope boundary:** Phase 1 targets executor and lifecycle recovery only. Persistent `spawn_agent` registry, Octto auto-resume registry, PTY orphan cleanup, and separate worktree manifests are explicitly deferred.

## Approach

We will add a lifecycle-scoped executor recovery layer built from three pieces: **execution journal events**, **executor leases**, and a **conservative resume resolver**.

The journal records durable execution events at the lifecycle level. The lease prevents two executors from mutating the same issue branch at once. The resolver reconciles lifecycle state, plan artifacts, git state, and issue markers before deciding whether to continue, backfill, retry, or block.

This gives us safe restart recovery without pretending that in-flight LLM sessions can be revived. Recovery is based on observable side effects and durable checkpoints, not model memory.

## Architecture

**Lifecycle record remains the machine state root:** The executor journal and lease belong to the lifecycle record for the issue. GitHub issue comments remain the human-readable event stream and cross-conversation index.

**Event-sourced executor journal:** Instead of storing only a mutable task status, lifecycle records append compact events such as batch dispatched, review completed, commit observed, recovery inspected, and recovery blocked. Current execution state is derived from those events.

**Conservative resume resolver:** On resume, the resolver checks the lifecycle record, expected branch, worktree path, plan artifact, recent commits, issue state, and working tree cleanliness. It only resumes automatically when the state is provably safe.

**Side-effect fencing:** Commits and lifecycle progress comments include stable markers for issue, batch, task, attempt, and journal sequence. Recovery uses those markers to avoid duplicate commits, duplicate comments, and duplicate PRs.

## Components

**Execution journal:** Records append-only lifecycle events for executor progress. It stores minimal metadata: issue number, batch id, task id, attempt id, event kind, timestamp, summary, commit marker, and review outcome summary.

**Executor lease:** Records one active executor owner for a lifecycle. It includes owner session, host, branch, worktree, acquired time, heartbeat, and expiry. A new executor cannot take over until the lease is expired or safely stolen and journaled.

**Resume resolver:** Produces one recovery decision: clean resume, reconciled resume, partial resume, or blocked. It does not mutate state during inspection. State changes are applied only after a deterministic recovery decision is produced.

**Executor checkpoint protocol:** Executor writes a checkpoint before dispatching a batch, after receiving task results, after reviewer completion, and after observing a commit. Batch-level recovery is the first supported granularity.

**Issue progress markers:** GitHub issue comments stay concise and human-readable, with hidden idempotency markers. Full raw journal data stays local in lifecycle state.

## Data Flow

**Normal execution:**

- Planner writes a plan artifact.
- Executor resolves the lifecycle and acquires a lease.
- Executor derives batches from the plan.
- Before dispatch, executor appends a batch-dispatched event.
- Implementers and reviewers run.
- Executor appends review and batch-completed events.
- Commit and issue progress markers are recorded after observable success.
- Lease is released or advanced to the next batch.

**Restart recovery:**

- User says "continue" after OpenCode restart.
- Primary agent resolves the lifecycle issue and worktree.
- Executor loads the lifecycle record and journal.
- Resolver checks lease, branch, worktree, plan, issue state, recent commits, and dirty tree state.
- Safe completed work is skipped or backfilled.
- Safe unfinished work resumes from the first incomplete batch.
- Ambiguous stale work becomes blocked with a concise recovery diagnosis.

## Error Handling

**Stale dispatched batch:** A dispatched batch without completion is never blindly retried. The resolver first checks for observable side effects.

- If matching commit markers exist, backfill completion.
- If worktree is clean and no matching side effects exist, safe retry is allowed.
- If unknown file changes exist, mark `needs_reconcile` and block.
- If branch, worktree, issue state, or origin identity differs from lifecycle expectations, block.

**Lease conflict:** If another executor lease is active, automatic resume stops. If the lease is expired, the resolver may steal it only after journaling the recovery decision.

**Corrupt or missing journal:** Fall back to existing lifecycle, issue, git, and plan recovery. Do not invent completion state. Mark recovery as partial or blocked when evidence is insufficient.

**Remote drift:** Before pushing or mutating GitHub, ownership preflight still runs. If the recorded origin and current origin differ, automatic remote mutation is refused.

## Testing Strategy

**Recovery behavior:**

- Restart after batch dispatch but before implementer completion.
- Restart after review passes but before commit marker is written.
- Restart after commit succeeds but issue progress sync fails.
- Resume when a lease is active, expired, or missing.
- Resume with wrong branch, dirty worktree, closed issue, or changed origin.
- Resume with journal corruption or an older lifecycle schema.

**Idempotency behavior:**

- Duplicate resume attempts do not duplicate issue comments.
- Duplicate resume attempts do not create duplicate commits when markers already exist.
- Completed batches are skipped.
- Ambiguous stale batches block instead of guessing.

**Schema behavior:**

- Existing lifecycle records without executor journal load successfully.
- Journal events validate with Valibot at system boundaries.
- Versioned lifecycle records migrate without losing existing fields.

## Open Questions

No user-facing decisions remain for Phase 1. Implementation should choose the smallest schema that supports batch-level recovery and defer task-level or subagent-session recovery until real usage proves it is needed.
