---
date: 2026-05-02
topic: "Subagent Review Outcome Titles"
status: validated
---

# Subagent Review Outcome Titles

## Problem Statement

Issue 18 fixed the specific false-positive path where narrative mentions of failure markers could preserve successful subagent sessions as failed. The new production report is different: reviewer subagents are successfully completing their assigned review, but their valid review decision is `CHANGES REQUESTED`. Today `spawn_agent` maps that domain outcome to `task_error`, then maps `task_error` to the session title `失败:` and preserves the conversation for resume.

That conflates two different concepts:

- **Agent execution status:** whether the subagent ran, produced a usable result, and the parent received it.
- **Domain outcome:** whether the reviewer approved the task or requested changes.

The user-visible title should not say `失败:` when the reviewer did its job and asked for fixes. The executor still needs the review decision to drive implementer fix cycles, but the child conversation should be titled and cleaned up as a normal completed review outcome, not an infrastructure failure.

## Constraints

- Preserve executor behavior: `CHANGES REQUESTED` must still cause a fix cycle.
- Preserve `resume_subagent` for genuine blocked or failed child sessions where continuing the same session is useful.
- Avoid broad public contract churn unless there is no safe compatibility path.
- Keep classification deterministic for clear review decisions.
- Keep LLM verification only for ambiguous marker-hit outputs.
- Cleanup failures must not change the parent result.

## Approach

The chosen approach is to split **execution lifecycle** from **review decision semantics** while keeping the parent orchestration signal intact.

**Reviewer `CHANGES REQUESTED` becomes a normal completed review outcome**, not a failed child execution. The parent still receives a machine-readable signal that changes were requested, but the internal session title should become something like `需修改:` or `已完成:` depending on the chosen title vocabulary, and the session should not be preserved for `resume_subagent` by default.

Genuine infrastructure failures remain titled as `失败:`. Genuine blockers remain titled as `阻塞:` and stay resumable.

## Architecture

The change touches four areas.

**Outcome classification:** The classifier should distinguish final review markers from execution failure markers. A final reviewer `CHANGES REQUESTED` is a domain decision. A final `TEST FAILED` or `BUILD FAILED` can still represent task error when emitted by implementers or generic agents, but reviewer decisions need separate handling.

**Spawn result formatting:** `spawn_agent` should expose enough structured information for the executor to know that review changes were requested. If the public outcome must remain compatible, the domain outcome can be added as an auxiliary field or diagnostic while retaining a parent-facing status that existing executor prompts understand.

**Session title naming:** Title generation should not map every parent-facing `task_error` to `失败:`. It should consider the domain outcome and agent role. Reviewer changes-requested should use a non-failure title.

**Registry preservation:** The registry should only preserve sessions that can be usefully resumed. A reviewer that cleanly returned `CHANGES REQUESTED` does not need resume. Its result is already captured by the parent and should be deleted or marked completed after collection.

## Components

**Classification model:** Adds a domain outcome dimension for review decisions and keeps infrastructure outcome separate.

**Verifier adapter:** Continues to confirm ambiguous narrative markers. For reviewer final markers, it should identify whether the marker is a real review decision rather than an execution failure.

**Naming policy:** Maps combinations of agent role, execution outcome, and domain outcome to user-facing Chinese titles.

**Preservation policy:** Decides whether to keep a child session for resume. This should be based on resumability, not merely on whether the domain work needs another implementation cycle.

**Executor prompt contract:** Teaches executor to treat reviewer changes-requested as a normal review result that triggers fix dispatch, not as a failed subagent that should be resumed.

## Data Flow

**Reviewer requests changes:**

1. Reviewer completes and emits a clear final `CHANGES REQUESTED` decision.
2. Classifier records execution as completed and domain outcome as changes requested.
3. Formatter includes the review decision in the spawn result so executor can launch a fix cycle.
4. Naming policy avoids `失败:` and uses a review-specific non-failure title.
5. Registry does not preserve the session for resume unless there is an actual blocked or failed execution state.

**Reviewer genuinely fails:**

1. Reviewer crashes, returns no usable output, or reports an unrecoverable tool/runtime failure.
2. Classifier records execution failure.
3. Naming policy uses `失败:`.
4. The session is deleted or preserved according to whether resume is useful.

**Reviewer blocked:**

1. Reviewer explicitly reports a blocker that requires user or parent intervention.
2. Classifier records blocked execution.
3. Naming policy uses `阻塞:`.
4. Registry preserves the session for `resume_subagent`.

## Error Handling

- If the domain outcome cannot be parsed, fall back to current safe behavior, but include diagnostics.
- If title update fails, retry with existing internal session update patterns and log the failure.
- If deletion fails for a completed review session, leave a diagnostic but do not mark the parent task failed.
- If old sessions already show `失败:` for clean review decisions, provide a cleanup or retitle utility path after the code fix.

## Testing Strategy

- Reviewer final `CHANGES REQUESTED` should not produce a `失败:` title.
- Reviewer final `CHANGES REQUESTED` should still cause executor fix-cycle behavior.
- Implementer or generic final hard failure markers should still produce `task_error` and failure titles when appropriate.
- Ambiguous narrative mentions of `CHANGES REQUESTED` should still go through verifier and avoid false failure.
- Completed review sessions should not be preserved in the resume registry unless explicitly blocked.
- Stale `执行中:` reviewer sessions should get a completion title or be deleted after result collection.
- Existing `resume_subagent` tests should continue to pass for genuine blocked and task-error sessions.

## Open Questions

- Whether the non-failure reviewer title should be `需修改:` or `已审查:`. I prefer `需修改:` because it is honest about the review result without implying infrastructure failure.
- Whether to add a new public outcome or keep compatibility by adding domain outcome metadata. I prefer compatibility first unless executor parsing becomes brittle.
