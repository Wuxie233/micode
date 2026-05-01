---
date: 2026-05-02
topic: "Subagent Review Outcome Titles"
issue: 20
scope: spawn-agent
contract: none
---

# Subagent Review Outcome Titles Implementation Plan

**Goal:** Stop labeling reviewer subagents as `失败:` when they correctly return `CHANGES REQUESTED`, while preserving the executor's fix-cycle behavior and the resume path for genuine failures and blockers.

**Architecture:** Split execution lifecycle from review decision semantics inside `spawn-agent`. Introduce a new internal class (`REVIEW_CHANGES_REQUESTED`) and a matching public outcome (`review_changes_requested`) that flow as a non-failure result: dedicated 需修改 title, no registry preservation, executor still receives a deterministic signal it can branch on. Implementer/general agents continue to use `task_error` for `TEST FAILED` / `BUILD FAILED`. The verifier/marker-confidence path is unchanged. A small retitle utility cleans up already-misclassified preserved sessions.

**Design:** thoughts/shared/designs/2026-05-02-subagent-review-outcome-title-design.md

**Contract:** none (plugin-internal change; no client/server boundary)

---

## Decisions filling design gaps

- **Title vocabulary:** use `需修改:` for the new non-failure reviewer outcome (the design's stated preference).
- **Public outcome name:** `review_changes_requested`. New value rather than overloading `success` so executor parsing stays deterministic.
- **Domain dispatch:** the new class is reachable ONLY when the spawning agent name is `reviewer`. Implementers and other roles emitting `CHANGES REQUESTED` continue down the existing `task_error` path. This avoids leakage from copy-paste prompts.
- **Session lifecycle for review_changes_requested:** keep the OpenCode session (so the user can read the review report) but DO NOT preserve it in the in-memory registry. `resume_subagent` returns `Session not preserved or expired.` — fix cycles go through fresh implementer + reviewer spawns, which matches the executor contract.
- **Title update path:** mirror the existing preserve flow — call `updateInternalSession` with the 需修改 title BEFORE returning, so any stale `执行中:` title is overwritten.
- **Misclassified-session cleanup:** ship a pure utility (`retitleStaleReviewSessions`) that scans a preserved registry and retitles+removes review sessions whose stored output contains a final `CHANGES REQUESTED` anchored marker. Not exposed as a public tool yet (in-memory registry, restart drops it); the function is callable from the plugin entrypoint or future migration scripts and is fully unit-tested.
- **Executor prompt:** documentation-only update so the executor knows `review_changes_requested` triggers a fix cycle and is NOT a resume target.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3 [foundation - constants/types, no deps]
Batch 2 (parallel): 2.1, 2.2 [classifier + naming - depend on Batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3 [tool flow + format + retitle utility - depend on Batch 2]
Batch 4 (sequential): 4.1, 4.2 [executor doc + reviewer guidance - depend on Batch 3]
```

---

## Batch 1: Foundation (parallel - 3 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Promote CHANGES REQUESTED to its own marker set
**File:** `src/tools/spawn-agent/classify-tokens.ts`
**Test:** `tests/tools/spawn-agent/classify-tokens.test.ts`
**Depends:** none
**Domain:** general

Why: today `CHANGES REQUESTED` lives in `TASK_ERROR_MARKERS`, so any agent emitting it lands in `task_error`. We need a separate group so the classifier can branch by agent role without re-tokenising the string. `TEST FAILED` and `BUILD FAILED` stay in `TASK_ERROR_MARKERS` for implementers and general agents. Existing exports stay so other modules keep compiling unchanged.

Test (extend the existing file; do not delete prior test cases):

```typescript
// tests/tools/spawn-agent/classify-tokens.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import {
  containsAnyMarker,
  matchesAnyPattern,
  REVIEW_DECISION_MARKERS,
  TASK_ERROR_MARKERS,
  TRANSIENT_NETWORK_PATTERNS,
} from "@/tools/spawn-agent/classify-tokens";

describe("classify-tokens review decision separation", () => {
  it("REVIEW_DECISION_MARKERS contains CHANGES REQUESTED", () => {
    expect(REVIEW_DECISION_MARKERS).toContain("CHANGES REQUESTED");
  });

  it("TASK_ERROR_MARKERS no longer contains CHANGES REQUESTED", () => {
    expect(TASK_ERROR_MARKERS).not.toContain("CHANGES REQUESTED");
  });

  it("TASK_ERROR_MARKERS still contains TEST FAILED and BUILD FAILED", () => {
    expect(TASK_ERROR_MARKERS).toContain("TEST FAILED");
    expect(TASK_ERROR_MARKERS).toContain("BUILD FAILED");
  });

  it("REVIEW_DECISION_MARKERS works with containsAnyMarker", () => {
    expect(containsAnyMarker("CHANGES REQUESTED: fix lint", REVIEW_DECISION_MARKERS)).toBe(true);
    expect(containsAnyMarker("APPROVED", REVIEW_DECISION_MARKERS)).toBe(false);
  });

  it("matchesAnyPattern keeps existing transient behaviour", () => {
    expect(matchesAnyPattern("ECONNRESET while reading", TRANSIENT_NETWORK_PATTERNS)).toBe(true);
  });
});
```

Implementation:

```typescript
// src/tools/spawn-agent/classify-tokens.ts (full replacement)
export const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /fetch failed/i,
  /socket hang up/i,
  /stream\s+(aborted|reset|closed)/i,
];

export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_SERVICE_UNAVAILABLE = 503;
export const HTTP_GATEWAY_TIMEOUT = 504;

export const TRANSIENT_HTTP_STATUSES: readonly number[] = [
  HTTP_TOO_MANY_REQUESTS,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
];

export const TASK_ERROR_MARKERS: readonly string[] = ["TEST FAILED", "BUILD FAILED"];
export const REVIEW_DECISION_MARKERS: readonly string[] = ["CHANGES REQUESTED"];
export const BLOCKED_MARKERS: readonly string[] = ["BLOCKED:", "ESCALATE:"];

export function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

export function containsAnyMarker(value: string, markers: readonly string[]): boolean {
  return markers.some((m) => value.includes(m));
}
```

**Verify:** `bun test tests/tools/spawn-agent/classify-tokens.test.ts`
**Commit:** `feat(spawn-agent): split CHANGES REQUESTED into REVIEW_DECISION_MARKERS`

---

### Task 1.2: Add 需修改 status to conversation-title format
**File:** `src/utils/conversation-title/format.ts`
**Test:** `tests/utils/conversation-title/format.test.ts`
**Depends:** none
**Domain:** general

Why: the title vocabulary is centralized in `TITLE_STATUS`. We add a new conclusive status `REVIEW_CHANGES_REQUESTED = "需修改"` and include it in `CONCLUSIVE_STATUSES` so topic and issue-aware titles render the suffix correctly. `buildTitle` works through the union type unchanged.

Test (additions only; do not modify existing assertions):

```typescript
// tests/utils/conversation-title/format.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import {
  buildTitle,
  buildTopicTitle,
  CONCLUSIVE_STATUSES,
  TITLE_STATUS,
} from "@/utils/conversation-title/format";

describe("TITLE_STATUS.REVIEW_CHANGES_REQUESTED", () => {
  it("equals the Chinese phrase 需修改", () => {
    expect(TITLE_STATUS.REVIEW_CHANGES_REQUESTED).toBe("需修改");
  });

  it("is part of CONCLUSIVE_STATUSES", () => {
    expect(CONCLUSIVE_STATUSES).toContain(TITLE_STATUS.REVIEW_CHANGES_REQUESTED);
  });

  it("buildTitle renders summary with 需修改 prefix", () => {
    expect(
      buildTitle({ status: TITLE_STATUS.REVIEW_CHANGES_REQUESTED, summary: "审查 PR #42" }),
    ).toBe("需修改: 审查 PR #42");
  });

  it("buildTopicTitle treats 需修改 as conclusive suffix", () => {
    expect(
      buildTopicTitle({ topic: "users module", status: TITLE_STATUS.REVIEW_CHANGES_REQUESTED }),
    ).toBe("users module · 需修改");
  });
});
```

Implementation diff (only the constants block changes; everything else is preserved):

```typescript
// src/utils/conversation-title/format.ts — change ONLY these two top-of-file blocks.
// (Leave buildTitle, buildTopicTitle, buildIssueAwareTitle, summary helpers, and
//  every existing constant exactly as they are.)
export const TITLE_STATUS = {
  INITIALIZING: "初始化",
  PLANNING: "规划中",
  EXECUTING: "执行中",
  DONE: "已完成",
  FAILED: "失败",
  BLOCKED: "阻塞",
  REVIEW_CHANGES_REQUESTED: "需修改",
} as const;

export type TitleStatus = (typeof TITLE_STATUS)[keyof typeof TITLE_STATUS];

export const CONCLUSIVE_STATUSES: readonly TitleStatus[] = [
  TITLE_STATUS.DONE,
  TITLE_STATUS.FAILED,
  TITLE_STATUS.BLOCKED,
  TITLE_STATUS.REVIEW_CHANGES_REQUESTED,
];
```

**Verify:** `bun test tests/utils/conversation-title/format.test.ts`
**Commit:** `feat(conversation-title): add REVIEW_CHANGES_REQUESTED 需修改 status`

---

### Task 1.3: Add review_changes_requested public outcome and shape
**File:** `src/tools/spawn-agent/types.ts`
**Test:** `tests/tools/spawn-agent/types.test.ts`
**Depends:** none
**Domain:** general

Why: the executor and the formatter must be able to discriminate `review_changes_requested` from `success` and from `task_error`. We add a new outcome literal AND a new result shape `SpawnReviewChanges` (no `sessionId`, no `resumeCount`: it's not preserved). The discriminated union grows by one variant, so `SpawnResult` consumers must add a branch — that's intentional and surfaces the change at compile time. We do not alter `SpawnPreserved` or `SpawnSuccess`.

Test (extend the existing file; do not delete prior test cases):

```typescript
// tests/tools/spawn-agent/types.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import { SPAWN_OUTCOMES, type SpawnReviewChanges, type SpawnResult } from "@/tools/spawn-agent/types";

describe("SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED", () => {
  it("exposes review_changes_requested literal", () => {
    expect(SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED).toBe("review_changes_requested");
  });

  it("SpawnReviewChanges narrows under SpawnResult discriminated union", () => {
    const result: SpawnResult = {
      outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      description: "Review 2.3",
      agent: "reviewer",
      elapsedMs: 1234,
      output: "CHANGES REQUESTED: rename foo to bar",
    };

    if (result.outcome === SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED) {
      const narrowed: SpawnReviewChanges = result;
      expect(narrowed.output).toContain("CHANGES REQUESTED");
      expect(narrowed.agent).toBe("reviewer");
      // Must NOT carry a sessionId — review_changes_requested is not resumable.
      expect("sessionId" in narrowed).toBe(false);
    } else {
      throw new Error("expected review_changes_requested branch");
    }
  });
});
```

Implementation:

```typescript
// src/tools/spawn-agent/types.ts (full replacement)
export const SPAWN_OUTCOMES = {
  SUCCESS: "success",
  TASK_ERROR: "task_error",
  BLOCKED: "blocked",
  HARD_FAILURE: "hard_failure",
  REVIEW_CHANGES_REQUESTED: "review_changes_requested",
} as const;

export type SpawnOutcome = (typeof SPAWN_OUTCOMES)[keyof typeof SPAWN_OUTCOMES];

export interface SpawnSuccess {
  readonly outcome: typeof SPAWN_OUTCOMES.SUCCESS;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly output: string;
  readonly diagnostics?: string;
}

export interface SpawnPreserved {
  readonly outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly sessionId: string;
  readonly output: string;
  readonly resumeCount: number;
  readonly diagnostics?: string;
}

export interface SpawnHardFailure {
  readonly outcome: typeof SPAWN_OUTCOMES.HARD_FAILURE;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly error: string;
  readonly diagnostics?: string;
}

export interface SpawnReviewChanges {
  readonly outcome: typeof SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly output: string;
  readonly diagnostics?: string;
}

export type SpawnResult = SpawnSuccess | SpawnPreserved | SpawnHardFailure | SpawnReviewChanges;

export interface ResumeSubagentInput {
  readonly session_id: string;
  readonly hint?: string;
}

export interface ResumeSubagentResult {
  readonly outcome: SpawnOutcome;
  readonly sessionId: string | null;
  readonly resumeCount: number;
  readonly output: string;
}
```

**Verify:** `bun test tests/tools/spawn-agent/types.test.ts`
**Commit:** `feat(spawn-agent): add review_changes_requested public outcome and shape`

---

## Batch 2: Classifier & Naming (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Make classify role-aware and recognise REVIEW_CHANGES_REQUESTED
**File:** `src/tools/spawn-agent/classify.ts`
**Test:** `tests/tools/spawn-agent/classify.test.ts`
**Depends:** 1.1
**Domain:** general

Why: the classifier currently returns `task_error` whenever any final marker hits, regardless of agent role. We add an optional `agent` field on `ClassifyInput` and a new internal class `REVIEW_CHANGES_REQUESTED`. The decision tree:

- Final-anchored marker from `REVIEW_DECISION_MARKERS` AND agent role is `reviewer` → `REVIEW_CHANGES_REQUESTED`.
- Final-anchored marker from `REVIEW_DECISION_MARKERS` AND agent role is anything else → `TASK_ERROR` (legacy behaviour for non-reviewer agents that emit `CHANGES REQUESTED`).
- Final-anchored marker from `TASK_ERROR_MARKERS` → `TASK_ERROR` (unchanged).
- Final-anchored marker from `BLOCKED_MARKERS` → `BLOCKED` (unchanged).
- Narrative (non-anchored) markers continue to go through `NEEDS_VERIFICATION` regardless of role.

The `agent` is normalised by lower-casing and stripping the `spawn-agent.` prefix so we match the same value the rest of the codebase uses.

Test (extend the existing file; preserve existing assertions):

```typescript
// tests/tools/spawn-agent/classify.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import { classifySpawnError, INTERNAL_CLASSES } from "@/tools/spawn-agent/classify";

describe("classifySpawnError review-vs-execution split", () => {
  it("returns REVIEW_CHANGES_REQUESTED when reviewer emits a final CHANGES REQUESTED marker", () => {
    const result = classifySpawnError({
      assistantText: "Reviewed task 2.3.\nCHANGES REQUESTED: rename foo to bar.",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED);
    expect(result.markerHit).toBe("CHANGES REQUESTED");
  });

  it("returns REVIEW_CHANGES_REQUESTED when agent name is namespaced (spawn-agent.reviewer)", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED: missing tests",
      agent: "spawn-agent.reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED);
  });

  it("still returns TASK_ERROR for implementer agents emitting CHANGES REQUESTED (legacy safety net)", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED: cannot find file",
      agent: "implementer-backend",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("still returns TASK_ERROR for reviewer emitting TEST FAILED (execution failure stays separate)", () => {
    const result = classifySpawnError({
      assistantText: "TEST FAILED",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("still returns BLOCKED for reviewer emitting a blocker", () => {
    const result = classifySpawnError({
      assistantText: "BLOCKED: missing fixture",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.BLOCKED);
  });

  it("narrative CHANGES REQUESTED still goes to NEEDS_VERIFICATION even for reviewer", () => {
    const result = classifySpawnError({
      assistantText: "All passed. The reviewer would print 'CHANGES REQUESTED' if anything broke.",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
    expect(result.ambiguousKind).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("falls back to legacy TASK_ERROR mapping when agent is omitted", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });
});
```

Implementation:

```typescript
// src/tools/spawn-agent/classify.ts (full replacement)
import { extractErrorMessage } from "@/utils/errors";
import {
  BLOCKED_MARKERS,
  matchesAnyPattern,
  REVIEW_DECISION_MARKERS,
  TASK_ERROR_MARKERS,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_PATTERNS,
} from "./classify-tokens";
import { classifyMarker, MARKER_CONFIDENCE } from "./marker-confidence";

export const INTERNAL_CLASSES = {
  SUCCESS: "success",
  TASK_ERROR: "task_error",
  BLOCKED: "blocked",
  HARD_FAILURE: "hard_failure",
  TRANSIENT: "transient",
  NEEDS_VERIFICATION: "needs_verification",
  REVIEW_CHANGES_REQUESTED: "review_changes_requested",
} as const;

export type InternalClass = (typeof INTERNAL_CLASSES)[keyof typeof INTERNAL_CLASSES];

export type AmbiguousKind = typeof INTERNAL_CLASSES.TASK_ERROR | typeof INTERNAL_CLASSES.BLOCKED;

export interface ClassifyInput {
  readonly thrown?: unknown;
  readonly httpStatus?: number | null;
  readonly assistantText?: string | null;
  readonly agent?: string | null;
}

export interface ClassifyResult {
  readonly class: InternalClass;
  readonly reason: string;
  readonly markerHit?: string;
  readonly ambiguousKind?: AmbiguousKind;
}

const REVIEWER_AGENT = "reviewer";
const SPAWN_AGENT_PREFIX = "spawn-agent.";

const EMPTY_RESPONSE_REASON = "empty response";
const SUCCESS_REASON = "assistant output present";
const FINAL_MARKER_REASON = "final-status marker";
const FINAL_REVIEW_REASON = "final review decision";
const NARRATIVE_MARKER_REASON = "narrative marker requires verification";
const HTTP_STATUS_REASON = "transient HTTP status";

function hasThrown(thrown: unknown): boolean {
  return thrown !== null && thrown !== undefined;
}

function normalizeAssistantText(input: ClassifyInput): string {
  return input.assistantText?.trim() ?? "";
}

function normalizeAgent(agent: string | null | undefined): string {
  if (typeof agent !== "string") return "";
  const trimmed = agent.trim().toLowerCase();
  return trimmed.startsWith(SPAWN_AGENT_PREFIX) ? trimmed.slice(SPAWN_AGENT_PREFIX.length) : trimmed;
}

function isReviewerAgent(agent: string | null | undefined): boolean {
  return normalizeAgent(agent) === REVIEWER_AGENT;
}

function isTransientStatus(status: number | null | undefined): status is number {
  if (status === null || status === undefined) return false;
  return TRANSIENT_HTTP_STATUSES.includes(status);
}

function transientFailure(input: ClassifyInput, thrown: boolean, message: string): ClassifyResult | null {
  if (thrown && matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: message };
  }
  if (isTransientStatus(input.httpStatus)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: `${HTTP_STATUS_REASON} ${input.httpStatus}` };
  }
  return null;
}

function reviewFinalMarker(text: string, isReviewer: boolean): ClassifyResult | null {
  const result = classifyMarker(text, REVIEW_DECISION_MARKERS);
  if (result.confidence !== MARKER_CONFIDENCE.FINAL || result.marker === null) return null;
  if (isReviewer) {
    return {
      class: INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED,
      reason: `${FINAL_REVIEW_REASON} ${result.marker}`,
      markerHit: result.marker,
    };
  }
  return {
    class: INTERNAL_CLASSES.TASK_ERROR,
    reason: `${FINAL_MARKER_REASON} ${result.marker}`,
    markerHit: result.marker,
  };
}

function executionFinalMarker(text: string): ClassifyResult | null {
  const blocked = classifyMarker(text, BLOCKED_MARKERS);
  if (blocked.confidence === MARKER_CONFIDENCE.FINAL && blocked.marker !== null) {
    return {
      class: INTERNAL_CLASSES.BLOCKED,
      reason: `${FINAL_MARKER_REASON} ${blocked.marker}`,
      markerHit: blocked.marker,
    };
  }
  const taskError = classifyMarker(text, TASK_ERROR_MARKERS);
  if (taskError.confidence === MARKER_CONFIDENCE.FINAL && taskError.marker !== null) {
    return {
      class: INTERNAL_CLASSES.TASK_ERROR,
      reason: `${FINAL_MARKER_REASON} ${taskError.marker}`,
      markerHit: taskError.marker,
    };
  }
  return null;
}

function narrativeMarker(text: string): ClassifyResult | null {
  const blocked = classifyMarker(text, BLOCKED_MARKERS);
  if (blocked.confidence === MARKER_CONFIDENCE.NARRATIVE && blocked.marker !== null) {
    return {
      class: INTERNAL_CLASSES.NEEDS_VERIFICATION,
      reason: `${NARRATIVE_MARKER_REASON} ${blocked.marker}`,
      markerHit: blocked.marker,
      ambiguousKind: INTERNAL_CLASSES.BLOCKED,
    };
  }
  const taskError = classifyMarker(text, TASK_ERROR_MARKERS);
  if (taskError.confidence === MARKER_CONFIDENCE.NARRATIVE && taskError.marker !== null) {
    return {
      class: INTERNAL_CLASSES.NEEDS_VERIFICATION,
      reason: `${NARRATIVE_MARKER_REASON} ${taskError.marker}`,
      markerHit: taskError.marker,
      ambiguousKind: INTERNAL_CLASSES.TASK_ERROR,
    };
  }
  const review = classifyMarker(text, REVIEW_DECISION_MARKERS);
  if (review.confidence === MARKER_CONFIDENCE.NARRATIVE && review.marker !== null) {
    return {
      class: INTERNAL_CLASSES.NEEDS_VERIFICATION,
      reason: `${NARRATIVE_MARKER_REASON} ${review.marker}`,
      markerHit: review.marker,
      ambiguousKind: INTERNAL_CLASSES.TASK_ERROR,
    };
  }
  return null;
}

function emptyFailure(text: string, thrown: boolean, message: string): ClassifyResult | null {
  if (thrown && text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: message };
  if (text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: EMPTY_RESPONSE_REASON };
  return null;
}

export function classifySpawnError(input: ClassifyInput): ClassifyResult {
  const assistantText = normalizeAssistantText(input);
  const thrown = hasThrown(input.thrown);
  const message = thrown ? extractErrorMessage(input.thrown) : "";

  const transient = transientFailure(input, thrown, message);
  if (transient !== null) return transient;

  const isReviewer = isReviewerAgent(input.agent);

  const review = reviewFinalMarker(assistantText, isReviewer);
  if (review !== null) return review;

  const execution = executionFinalMarker(assistantText);
  if (execution !== null) return execution;

  const empty = emptyFailure(assistantText, thrown, message);
  if (empty !== null) return empty;

  const narrative = narrativeMarker(assistantText);
  if (narrative !== null) return narrative;

  return { class: INTERNAL_CLASSES.SUCCESS, reason: SUCCESS_REASON };
}
```

Notes for the implementer:
- Existing tests in `classify.test.ts` MUST keep passing. They do not pass `agent`, so `isReviewerAgent` returns `false` and the legacy mapping (`TASK_ERROR` for `CHANGES REQUESTED`) is preserved.
- `reviewFinalMarker` runs BEFORE `executionFinalMarker` so that a reviewer that emits both a CHANGES REQUESTED and a stray TEST FAILED line still routes to REVIEW_CHANGES_REQUESTED. This is the correct precedence: the reviewer's domain decision dominates.
- `narrativeMarker` keeps `ambiguousKind = TASK_ERROR` for narrative `CHANGES REQUESTED` — verifier path is unchanged.

**Verify:** `bun test tests/tools/spawn-agent/classify.test.ts tests/tools/spawn-agent/classify-verifier-integration.test.ts`
**Commit:** `feat(spawn-agent): add review_changes_requested classification path`

---

### Task 2.2: Map review_changes_requested to 需修改 in naming
**File:** `src/tools/spawn-agent/naming.ts`
**Test:** `tests/tools/spawn-agent/naming.test.ts`
**Depends:** 1.2, 1.3
**Domain:** general

Why: `outcomeToStatus` is an exhaustive switch on the spawn outcome literals. With the new `REVIEW_CHANGES_REQUESTED` literal added in Task 1.3, this switch must add the matching arm pointing at `TITLE_STATUS.REVIEW_CHANGES_REQUESTED` from Task 1.2. TypeScript will flag the missing arm if either of those tasks lands without this one.

Test (extend the existing file; preserve previous cases):

```typescript
// tests/tools/spawn-agent/naming.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import { buildSpawnCompletionTitle } from "@/tools/spawn-agent/naming";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

describe("buildSpawnCompletionTitle review_changes_requested", () => {
  it("maps review_changes_requested outcome to 需修改 status", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "审查 PR #42",
        outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      }),
    ).toBe("需修改: 审查 PR #42");
  });

  it("falls back to Chinese reviewer label when description is missing", () => {
    expect(
      buildSpawnCompletionTitle({
        agent: "reviewer",
        description: "",
        outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      }),
    ).toBe("需修改: 代码审查");
  });

  it("does NOT use 失败 status for review_changes_requested", () => {
    const title = buildSpawnCompletionTitle({
      agent: "reviewer",
      description: "审查 PR #42",
      outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    });
    expect(title.startsWith("失败")).toBe(false);
  });
});
```

Implementation:

```typescript
// src/tools/spawn-agent/naming.ts (full replacement)
import { buildTitle, TITLE_STATUS, type TitleStatus } from "@/utils/conversation-title/format";

import { agentRoleLabel } from "./agent-roles";
import { SPAWN_OUTCOMES, type SpawnOutcome } from "./types";

const DEFAULT_MAX_LENGTH = 50;
const RUNNING_STATUS: TitleStatus = TITLE_STATUS.EXECUTING;

export interface SpawnRunningTitleInput {
  readonly agent: string;
  readonly description: string;
}

export interface SpawnCompletionTitleInput {
  readonly agent: string;
  readonly description: string;
  readonly outcome: SpawnOutcome;
}

function pickSummary(input: SpawnRunningTitleInput): string {
  const trimmed = input.description.trim();
  if (trimmed.length > 0) return trimmed;

  return agentRoleLabel(input.agent);
}

function outcomeToStatus(outcome: SpawnOutcome): TitleStatus {
  switch (outcome) {
    case SPAWN_OUTCOMES.SUCCESS:
      return TITLE_STATUS.DONE;
    case SPAWN_OUTCOMES.BLOCKED:
      return TITLE_STATUS.BLOCKED;
    case SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED:
      return TITLE_STATUS.REVIEW_CHANGES_REQUESTED;
    case SPAWN_OUTCOMES.TASK_ERROR:
    case SPAWN_OUTCOMES.HARD_FAILURE:
      return TITLE_STATUS.FAILED;
  }
}

export function buildSpawnRunningTitle(input: SpawnRunningTitleInput, maxLength: number = DEFAULT_MAX_LENGTH): string {
  return buildTitle({ status: RUNNING_STATUS, summary: pickSummary(input) }, maxLength);
}

export function buildSpawnCompletionTitle(
  input: SpawnCompletionTitleInput,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  return buildTitle({ status: outcomeToStatus(input.outcome), summary: pickSummary(input) }, maxLength);
}
```

**Verify:** `bun test tests/tools/spawn-agent/naming.test.ts`
**Commit:** `feat(spawn-agent): map review_changes_requested to 需修改 title`

---

## Batch 3: Tool flow, formatter, retitle utility (parallel - 3 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3

### Task 3.1: Wire review_changes_requested through the spawn-agent tool flow
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** `tests/tools/spawn-agent/tool.test.ts`
**Depends:** 1.3, 2.1, 2.2
**Domain:** general

Why: this is the orchestration site. It must: (a) pass `task.agent` to `classifySpawnError` so the classifier can branch on role, (b) introduce a new finalize branch for `INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED` that updates the internal session title to 需修改 (overwriting the stale 执行中 title), deletes the running record from the spawn registry but does NOT preserve it in the registry, and emits a `SpawnReviewChanges` result with the full review output, and (c) leave the existing success/blocked/task_error/hard_failure paths untouched.

Test (focused new test file dedicated to this behaviour; do not delete existing tests):

```typescript
// tests/tools/spawn-agent/tool.test.ts (additions only — keep existing scenarios)
import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const SESSION_ID = "review_session_1";
const DIRECTORY = "/tmp/repo";
const REVIEW_OUTPUT = "Reviewed task 2.3.\nCHANGES REQUESTED: rename foo to bar.";
const REGISTRY_OPTS = { maxResumes: 2, ttlHours: 1 } as const;

interface UpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title?: string };
}

function buildCtx() {
  const create = mock(async () => ({ data: { id: SESSION_ID } }));
  const prompt = mock(async () => ({}));
  const messages = mock(async () => ({
    data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: REVIEW_OUTPUT }] }],
  }));
  const update = mock(async () => ({}));
  const del = mock(async () => ({}));
  const ctx = {
    client: { session: { create, prompt, messages, delete: del, update } },
    directory: DIRECTORY,
  } as never as PluginInput;
  return { ctx, create, update, delete: del };
}

describe("spawn-agent reviewer CHANGES REQUESTED flow", () => {
  it("emits a non-failure outcome with the full review output and no sessionId", async () => {
    const stubs = buildCtx();
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    const output = await tool.execute(
      { agents: [{ agent: "reviewer", prompt: "review 2.3", description: "审查 2.3" }] },
      { metadata: () => {} } as never,
    );

    expect(output).toContain(SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED);
    expect(output).toContain("CHANGES REQUESTED");
    // No 失败 status surfaced anywhere in the formatted output.
    expect(output).not.toContain("**Outcome**: task_error");
    expect(output).not.toContain("**Outcome**: hard_failure");
  });

  it("overwrites the 执行中 title with 需修改 BEFORE emitting the result", async () => {
    const stubs = buildCtx();
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      { agents: [{ agent: "reviewer", prompt: "review 2.3", description: "审查 2.3" }] },
      { metadata: () => {} } as never,
    );

    expect(stubs.update).toHaveBeenCalledTimes(1);
    const updateCall = stubs.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.path.id).toBe(SESSION_ID);
    expect(updateCall?.body.title).toBe("需修改: 审查 2.3");
  });

  it("does NOT preserve the session in the registry (resume_subagent must reject it later)", async () => {
    const stubs = buildCtx();
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      { agents: [{ agent: "reviewer", prompt: "review 2.3", description: "审查 2.3" }] },
      { metadata: () => {} } as never,
    );

    expect(registry.size()).toBe(0);
    expect(registry.get(SESSION_ID)).toBeNull();
  });

  it("does NOT delete the internal session (user keeps the review report visible)", async () => {
    const stubs = buildCtx();
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      { agents: [{ agent: "reviewer", prompt: "review 2.3", description: "审查 2.3" }] },
      { metadata: () => {} } as never,
    );

    // No session.delete call — the conversation lives on in the UI under 需修改: 审查 2.3.
    expect(stubs.delete).not.toHaveBeenCalled();
  });

  it("an implementer that emits CHANGES REQUESTED still goes through the legacy task_error preserve path", async () => {
    const stubs = buildCtx();
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    const tool = createSpawnAgentTool(stubs.ctx, { registry });

    await tool.execute(
      {
        agents: [{ agent: "implementer-backend", prompt: "do task", description: "实现 2.3" }],
      },
      { metadata: () => {} } as never,
    );

    // task_error path: title updated to 失败, registry preserved, session NOT deleted.
    expect(stubs.update).toHaveBeenCalledTimes(1);
    const updateCall = stubs.update.mock.calls[0]?.[0] as UpdateRequest | undefined;
    expect(updateCall?.body.title).toBe("失败: 实现 2.3");
    expect(registry.get(SESSION_ID)).not.toBeNull();
    expect(stubs.delete).not.toHaveBeenCalled();
  });
});
```

Implementation guidance — modify `src/tools/spawn-agent/tool.ts` with these targeted edits, leaving everything else (transient retry, generation fence, model resolution, diagnostics) untouched:

1. **Pass agent into the classifier** at both call sites:

   ```typescript
   // inside runAttempt:
   const classification = classifySpawnError({ assistantText: session.output, agent: task.agent });
   ```

   And in `classifyThrown`, also pass `agent: task.agent` (thread `task` through; current signature already has `task` available as a closure when called from `runAttempt`).

2. **Add a new helper for the review_changes_requested terminal step.** Place it next to `cleanupSession`:

   ```typescript
   async function finalizeReviewChanges(
     ctx: PluginInput,
     task: AgentTask,
     options: ResolvedSpawnAgentToolOptions,
     value: AttemptValue,
   ): Promise<void> {
     // Drop the running record so the generation fence sees the slot as free.
     options.spawnRegistry.complete(value.sessionId ?? UNKNOWN_SESSION_ID);
     // Overwrite the 执行中 title with 需修改 so the UI never shows a stale running title.
     await updateInternalSession({
       ctx,
       sessionId: value.sessionId,
       title: buildSpawnCompletionTitle({
         agent: task.agent,
         description: task.description,
         outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
       }),
     });
     // Do NOT delete the internal session — the user keeps the review report.
     // Do NOT preserve in the registry — review_changes_requested is not resumable.
   }

   function createReviewChangesResult(task: AgentTask, elapsedMs: number, output: string): SpawnResult {
     return {
       outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
       description: task.description,
       agent: task.agent,
       elapsedMs,
       output,
     };
   }
   ```

3. **Add the new branch to `finalizeSettled`** BEFORE the `SUCCESS` branch (priority over the success cleanup):

   ```typescript
   if (settled.class === INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED) {
     await finalizeReviewChanges(ctx, task, options, settled.value);
     return attachDiagnostics(task, createReviewChangesResult(task, elapsedMs, settled.value.output), fields);
   }
   ```

4. **Imports** — add `REVIEW_CHANGES_REQUESTED` to the existing `INTERNAL_CLASSES` import (it is already a member after Task 2.1) and ensure `updateInternalSession` is already imported (it is, used for preserve path).

5. **No changes** to `handleVerification`, `preserveSession`, `mirrorLegacyPreserve`, `blockedFenceResult`, the model override logging, or progress metadata. The verifier still resolves narrative ambiguous markers via the existing `INTERNAL_CLASSES.NEEDS_VERIFICATION` branch; reviewer-narrative `CHANGES REQUESTED` continues to be handled there because `narrativeMarker` keeps `ambiguousKind = TASK_ERROR`.

**Verify:** `bun test tests/tools/spawn-agent/tool.test.ts tests/tools/spawn-agent/preserve-on-failure.test.ts tests/tools/spawn-agent/naming-integration.test.ts tests/integration/spawn-agent-allsettled.test.ts`
**Commit:** `feat(spawn-agent): finalize review_changes_requested with 需修改 title and no preservation`

---

### Task 3.2: Render review_changes_requested as a non-failure formatted section
**File:** `src/tools/spawn-agent/format.ts`
**Test:** `tests/tools/spawn-agent/format.test.ts`
**Depends:** 1.3
**Domain:** general

Why: `formatSpawnResults` currently dispatches on `outcome` with three formatter helpers (`formatSuccess`, `formatPreserved`, `formatHardFailure`). After Task 1.3 the discriminated union has a fourth variant. We add a `formatReviewChanges` helper and route the new outcome through it. The output explicitly labels the outcome as `review_changes_requested` so the executor LLM has an unambiguous, machine-readable handle. The single-row table cell shows `-` for SessionID (the session was not preserved) which is the same convention used for success.

Test (additions only):

```typescript
// tests/tools/spawn-agent/format.test.ts (additions only)
import { describe, expect, it } from "bun:test";

import { formatSpawnResults } from "@/tools/spawn-agent/format";
import { SPAWN_OUTCOMES, type SpawnResult } from "@/tools/spawn-agent/types";

describe("formatSpawnResults review_changes_requested", () => {
  const reviewResult: SpawnResult = {
    outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    description: "审查 2.3",
    agent: "reviewer",
    elapsedMs: 1200,
    output: "CHANGES REQUESTED: rename foo to bar",
  };

  it("renders a single review_changes_requested result without **Outcome**: hard_failure or task_error", () => {
    const text = formatSpawnResults([reviewResult]);

    expect(text).toContain("review_changes_requested");
    expect(text).toContain("CHANGES REQUESTED");
    expect(text).toContain("审查 2.3");
    expect(text).not.toContain("**Outcome**: task_error");
    expect(text).not.toContain("**Outcome**: hard_failure");
  });

  it("emits SessionID '-' in the table row because review_changes_requested is not preserved", () => {
    const text = formatSpawnResults([reviewResult, reviewResult]);
    const tableLines = text.split("\n").filter((line) => line.startsWith("| 审查 2.3"));
    expect(tableLines.length).toBe(2);
    for (const line of tableLines) {
      // SessionID column is the 5th cell (1-indexed pipe-separated).
      expect(line.split("|")[5].trim()).toBe("-");
    }
  });

  it("table rows include the review_changes_requested outcome literal", () => {
    const text = formatSpawnResults([reviewResult]);
    const row = text.split("\n").find((line) => line.startsWith("| 审查 2.3"));
    expect(row).toBeDefined();
    expect(row).toContain("review_changes_requested");
  });
});
```

Implementation — extend `format.ts` with three small additions and adjust the dispatcher; do NOT alter the success/preserved/hard-failure helpers:

```typescript
// src/tools/spawn-agent/format.ts — add the imports/types from types.ts:
import {
  SPAWN_OUTCOMES,
  type SpawnHardFailure,
  type SpawnPreserved,
  type SpawnResult,
  type SpawnReviewChanges,
  type SpawnSuccess,
} from "./types";

// In getSessionId — review_changes_requested has no sessionId, return MISSING_SESSION:
function getSessionId(result: SpawnResult): string {
  if (result.outcome === SPAWN_OUTCOMES.TASK_ERROR) return result.sessionId;
  if (result.outcome === SPAWN_OUTCOMES.BLOCKED) return result.sessionId;
  return MISSING_SESSION;
}

// In getOutput — review_changes_requested carries `output`, identical to success:
function getOutput(result: SpawnResult): string {
  if (result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) return result.error;
  return result.output;
}

// New helper — mirror formatSuccess but label the section explicitly:
function formatReviewChanges(result: SpawnReviewChanges): string {
  return joinLines(
    appendDiagnostics(
      [
        `## ${result.description} (${formatElapsed(result.elapsedMs)})`,
        "",
        `**Agent**: ${result.agent}`,
        `**Outcome**: ${result.outcome}`,
        "",
        "### Review",
        "",
        result.output,
      ],
      result,
    ),
  );
}

// Update formatSection switch:
function formatSection(result: SpawnResult): string {
  switch (result.outcome) {
    case SPAWN_OUTCOMES.SUCCESS:
      return formatSuccess(result);
    case SPAWN_OUTCOMES.TASK_ERROR:
    case SPAWN_OUTCOMES.BLOCKED:
      return formatPreserved(result);
    case SPAWN_OUTCOMES.HARD_FAILURE:
      return formatHardFailure(result);
    case SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED:
      return formatReviewChanges(result);
    default:
      return assertNever(result);
  }
}
```

Notes:
- The `getSessionId` and `getOutput` helpers already use a default-fallthrough pattern; the new variant slots in cleanly without a dedicated case.
- `assertNever(result)` will catch any future fifth variant at compile time.

**Verify:** `bun test tests/tools/spawn-agent/format.test.ts`
**Commit:** `feat(spawn-agent): format review_changes_requested as a non-failure section`

---

### Task 3.3: Add a retitle utility for already-misclassified preserved review sessions
**File:** `src/tools/spawn-agent/retitle-stale-reviews.ts` (new file)
**Test:** `tests/tools/spawn-agent/retitle-stale-reviews.test.ts` (new file)
**Depends:** 1.1, 1.3, 2.2
**Domain:** general

Why: in-memory `PreservedRegistry` records do not survive plugin restart, so this utility is mostly defensive — but the design explicitly calls for a cleanup/retitle path for any session that landed in the preserved registry as `task_error` for a reviewer when the underlying output is in fact a final `CHANGES REQUESTED` review decision. The function takes a registry and a per-session output reader (so it stays testable without `ctx.client.session.messages`), classifies each preserved record using the new role-aware classifier, and for hits performs the canonical post-fix sequence: update the internal session title to 需修改 then remove the record from the registry. Failures are collected and returned, never thrown, so callers can log without aborting startup.

Test (new file):

```typescript
// tests/tools/spawn-agent/retitle-stale-reviews.test.ts
import { describe, expect, it, mock } from "bun:test";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { retitleStaleReviewSessions } from "@/tools/spawn-agent/retitle-stale-reviews";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const REGISTRY_OPTS = { maxResumes: 2, ttlHours: 1 } as const;

const FINAL_REVIEW = "Reviewed task 2.3.\nCHANGES REQUESTED: rename foo to bar.";
const FINAL_TEST_FAILED = "TEST FAILED: assertion 4 broke";
const NARRATIVE_REVIEW = "All passed. The reviewer would print 'CHANGES REQUESTED' if anything broke.";

describe("retitleStaleReviewSessions", () => {
  it("retitles and removes preserved reviewer sessions whose output is a final CHANGES REQUESTED", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_1",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const updateTitle = mock(async () => undefined);
    const readOutput = mock(async () => FINAL_REVIEW);

    const result = await retitleStaleReviewSessions({ registry, readOutput, updateTitle });

    expect(result.retitled).toEqual(["rev_1"]);
    expect(result.skipped).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(registry.get("rev_1")).toBeNull();
    expect(updateTitle).toHaveBeenCalledTimes(1);
    const call = updateTitle.mock.calls[0] as readonly [{ readonly sessionId: string; readonly title: string }];
    expect(call[0].sessionId).toBe("rev_1");
    expect(call[0].title).toBe("需修改: 审查 2.3");
  });

  it("skips preserved reviewer sessions whose output is a real TEST FAILED execution failure", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_2",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const updateTitle = mock(async () => undefined);
    const readOutput = mock(async () => FINAL_TEST_FAILED);

    const result = await retitleStaleReviewSessions({ registry, readOutput, updateTitle });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_2"]);
    expect(registry.get("rev_2")).not.toBeNull();
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it("skips narrative CHANGES REQUESTED (reviewer must have produced a final marker)", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_3",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => NARRATIVE_REVIEW,
      updateTitle: async () => undefined,
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_3"]);
  });

  it("ignores preserved BLOCKED records and non-reviewer agents", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_4",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.BLOCKED,
    });
    registry.preserve({
      sessionId: "impl_1",
      agent: "implementer-backend",
      description: "实现",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => FINAL_REVIEW,
      updateTitle: async () => undefined,
    });

    expect(result.retitled).toEqual([]);
    expect(registry.get("rev_4")).not.toBeNull();
    expect(registry.get("impl_1")).not.toBeNull();
  });

  it("collects updateTitle failures and leaves the registry record in place", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_5",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => FINAL_REVIEW,
      updateTitle: async () => {
        throw new Error("update boom");
      },
    });

    expect(result.retitled).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sessionId).toBe("rev_5");
    expect(result.failures[0]?.error).toContain("update boom");
    // Registry record stays — caller may retry later.
    expect(registry.get("rev_5")).not.toBeNull();
  });

  it("collects readOutput failures as skipped (cannot reclassify without the text)", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_6",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => {
        throw new Error("read boom");
      },
      updateTitle: async () => undefined,
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_6"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sessionId).toBe("rev_6");
  });
});
```

Implementation:

```typescript
// src/tools/spawn-agent/retitle-stale-reviews.ts
import { extractErrorMessage } from "@/utils/errors";

import { classifySpawnError, INTERNAL_CLASSES } from "./classify";
import { buildSpawnCompletionTitle } from "./naming";
import type { PreservedRecord, PreservedRegistry } from "./registry";
import { SPAWN_OUTCOMES } from "./types";

const REVIEWER_AGENT = "reviewer";

export interface RetitleReadInput {
  readonly sessionId: string;
}

export interface RetitleUpdateInput {
  readonly sessionId: string;
  readonly title: string;
}

export interface RetitleStaleReviewsInput {
  readonly registry: PreservedRegistry;
  readonly readOutput: (input: RetitleReadInput) => Promise<string>;
  readonly updateTitle: (input: RetitleUpdateInput) => Promise<void>;
}

export interface RetitleFailure {
  readonly sessionId: string;
  readonly error: string;
}

export interface RetitleStaleReviewsResult {
  readonly retitled: readonly string[];
  readonly skipped: readonly string[];
  readonly failures: readonly RetitleFailure[];
}

interface RegistryWithList extends PreservedRegistry {
  readonly listAll?: () => readonly PreservedRecord[];
}

function listPreservedRecords(registry: PreservedRegistry): readonly PreservedRecord[] {
  // PreservedRegistry only exposes get / size; the underlying SpawnSessionRegistry has listPreserved.
  // We bridge via getSpawnRegistryForPreservedRegistry to avoid widening the public PreservedRegistry interface.
  // (Imported lazily so this file stays standalone-testable; see Task 3.3 notes.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bridge = require("./registry") as typeof import("./registry");
  const spawn = bridge.getSpawnRegistryForPreservedRegistry(registry);
  if (spawn === null) return [];
  return spawn.listPreserved().map((record) => ({
    sessionId: record.sessionId,
    agent: record.agent,
    description: record.description,
    outcome: record.outcome,
    preservedAt: record.preservedAt,
    resumeCount: record.resumeCount,
  }));
}

function isReviewerTaskError(record: PreservedRecord): boolean {
  return record.agent.trim().toLowerCase() === REVIEWER_AGENT && record.outcome === SPAWN_OUTCOMES.TASK_ERROR;
}

async function attemptRetitle(
  input: RetitleStaleReviewsInput,
  record: PreservedRecord,
): Promise<{ readonly outcome: "retitled" | "skipped"; readonly failure?: RetitleFailure }> {
  let output: string;
  try {
    output = await input.readOutput({ sessionId: record.sessionId });
  } catch (error) {
    return {
      outcome: "skipped",
      failure: { sessionId: record.sessionId, error: extractErrorMessage(error) },
    };
  }

  const classification = classifySpawnError({ assistantText: output, agent: record.agent });
  if (classification.class !== INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED) {
    return { outcome: "skipped" };
  }

  const title = buildSpawnCompletionTitle({
    agent: record.agent,
    description: record.description,
    outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
  });

  try {
    await input.updateTitle({ sessionId: record.sessionId, title });
  } catch (error) {
    return {
      outcome: "skipped",
      failure: { sessionId: record.sessionId, error: extractErrorMessage(error) },
    };
  }

  input.registry.remove(record.sessionId);
  return { outcome: "retitled" };
}

export async function retitleStaleReviewSessions(
  input: RetitleStaleReviewsInput,
): Promise<RetitleStaleReviewsResult> {
  const records = listPreservedRecords(input.registry).filter(isReviewerTaskError);

  const retitled: string[] = [];
  const skipped: string[] = [];
  const failures: RetitleFailure[] = [];

  for (const record of records) {
    const result = await attemptRetitle(input, record);
    if (result.outcome === "retitled") retitled.push(record.sessionId);
    else skipped.push(record.sessionId);
    if (result.failure) failures.push(result.failure);
  }

  return { retitled, skipped, failures };
}
```

Notes:
- `getSpawnRegistryForPreservedRegistry` already exists in `registry.ts` and is the supported bridge. The implementer MUST import it via a normal `import { getSpawnRegistryForPreservedRegistry } from "./registry";` — the `require` above is shorthand for the planning markdown only; rewrite as a top-of-file import to satisfy biome and the `no-require-imports` rule.
- The function does NOT call OpenCode session APIs directly. It receives `readOutput` and `updateTitle` as injected dependencies, identical in shape to `internal-session.ts` helpers. The plugin entrypoint can wire it as `readOutput = ({ sessionId }) => readSessionAssistantText(ctx, sessionId)` and `updateTitle = ({ sessionId, title }) => updateInternalSession({ ctx, sessionId, title })` if and when it wants to enable the cleanup. For now the function exists, is unit-tested, and is NOT auto-invoked.
- We do not delete the OpenCode session here; we only retitle and remove the registry record. This matches the new `review_changes_requested` flow in Task 3.1 (UI keeps the conversation, registry forgets it).

**Verify:** `bun test tests/tools/spawn-agent/retitle-stale-reviews.test.ts`
**Commit:** `feat(spawn-agent): add retitleStaleReviewSessions cleanup utility`

---

## Batch 4: Executor and reviewer prompt updates (sequential - 2 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2

### Task 4.1: Teach the executor to treat review_changes_requested as a fix-cycle trigger
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-prompt.test.ts` (new file)
**Depends:** 1.3, 3.1
**Domain:** general

Why: the executor agent prompt explicitly enumerates outcomes and how to react. Today it lists `success / task_error / blocked / hard_failure` and tells the LLM to call `resume_subagent` for `task_error`. After this change, reviewers no longer return `task_error` for clean review decisions, so the executor needs an explicit row for `review_changes_requested` that says: spawn a fix implementer (and a re-reviewer) in the next batch, do NOT call `resume_subagent`. We add prose, no code logic.

Test (new file — verifies the prompt contract via string assertions, since the executor agent file is a prompt-only module):

```typescript
// tests/agents/executor-prompt.test.ts
import { describe, expect, it } from "bun:test";

import { executor } from "@/agents/executor";

describe("executor agent prompt contract for review_changes_requested", () => {
  it("references the review_changes_requested outcome literal", () => {
    expect(executor.prompt).toContain("review_changes_requested");
  });

  it("documents that review_changes_requested triggers a fix cycle", () => {
    // The prompt MUST mention that this outcome maps to a fix implementer + re-reviewer
    // and is NOT a resume target. We assert on the structural keywords.
    const prompt = executor.prompt;
    expect(prompt).toContain("review_changes_requested");
    // Adjacent guidance words — the implementer is free to phrase, but at least one of
    // these fix-cycle anchors MUST appear within 400 chars of the outcome reference.
    const idx = prompt.indexOf("review_changes_requested");
    const window = prompt.slice(idx, idx + 400);
    const mentionsFixCycle = /fix\s+cycle|fix\s+implementer|re-?review|spawn.*fix/i.test(window);
    expect(mentionsFixCycle).toBe(true);
  });

  it("explicitly tells the executor NOT to resume_subagent on review_changes_requested", () => {
    const prompt = executor.prompt;
    const idx = prompt.indexOf("review_changes_requested");
    const window = prompt.slice(idx, idx + 400);
    expect(window.toLowerCase()).toMatch(/not.*resume|never.*resume|do not call resume/);
  });

  it("still documents resume_subagent for task_error and blocked", () => {
    expect(executor.prompt).toContain("task_error");
    expect(executor.prompt).toContain("blocked");
    expect(executor.prompt).toContain("resume_subagent");
  });
});
```

Implementation — edit the existing `<resume-handling>` block of `src/agents/executor.ts` to add a row for the new outcome. Keep every other section (domain dispatch, contract propagation, parallel batch protocol, examples) untouched. The exact text of the addition:

```text
<resume-handling priority="critical">
When a spawned subagent's outcome is "task_error" or "blocked" and a session_id is reported,
PREFER resume_subagent({ session_id, hint? }) over respawning a fresh subagent. Respawn is
only acceptable when:
- the agent type itself was wrong, or
- resume has already been attempted SUBAGENT_MAX_RESUMES_PER_SESSION times, or
- the user explicitly says respawn.

When a parallel batch returns mixed outcomes (Promise.allSettled), iterate the table:
- success: nothing to do.
- review_changes_requested: the reviewer cleanly returned a 需修改 verdict. This is NOT a
  failure and NOT a resume target. Spawn a fix implementer (matching the original task's
  Domain) plus a re-reviewer in the NEXT batch. Do NOT call resume_subagent on this outcome
  — the session is not preserved and resume_subagent will reject it.
- task_error / blocked: resume_subagent with a brief hint derived from the output.
- hard_failure: respawn with a corrected prompt.
</resume-handling>
```

Where in the file: this replaces the existing `<resume-handling>` block at the top of the prompt (around lines 69-81 of the current file). Do not relocate the block; just add the `review_changes_requested` bullet between `success` and `task_error / blocked`.

Notes:
- The `executor` export already exposes `.prompt` as a string (this is the standard `AgentConfig` shape across `src/agents/`). The test reads it directly.
- If the test file's import path needs an absolute alias, use `@/agents/executor` consistent with the rest of the test suite (`tests/tools/spawn-agent/*.ts` style).

**Verify:** `bun test tests/agents/executor-prompt.test.ts && bun run typecheck`
**Commit:** `docs(executor): document review_changes_requested fix-cycle handling`

---

### Task 4.2: Tighten reviewer prompt so CHANGES REQUESTED is always emitted as a final marker
**File:** `src/agents/reviewer.ts`
**Test:** `tests/agents/reviewer-prompt.test.ts` (new file)
**Depends:** 1.1, 2.1
**Domain:** general

Why: the new classifier only returns `REVIEW_CHANGES_REQUESTED` when the marker is FINAL (anchored on its own line per `marker-confidence.ts`). If the reviewer buries the verdict inside prose, the marker is classified as NARRATIVE and routed through the verifier. To keep the deterministic path predictable, the reviewer prompt must instruct the agent to emit `CHANGES REQUESTED:` as the LAST status line on its own line, after the report body. This is a prompt-only change; no code logic.

Test (new file):

```typescript
// tests/agents/reviewer-prompt.test.ts
import { describe, expect, it } from "bun:test";

import { reviewer } from "@/agents/reviewer";

describe("reviewer agent prompt status emission contract", () => {
  it("instructs the agent to emit APPROVED or CHANGES REQUESTED", () => {
    expect(reviewer.prompt).toContain("APPROVED");
    expect(reviewer.prompt).toContain("CHANGES REQUESTED");
  });

  it("requires the verdict line to be on its own line at the end", () => {
    const prompt = reviewer.prompt.toLowerCase();
    // At least one of these phrasings should appear, instructing final-line placement.
    const requiresFinalLine =
      /on its own line/i.test(reviewer.prompt) ||
      /final\s+line/i.test(reviewer.prompt) ||
      /last line/i.test(reviewer.prompt) ||
      /at the end/i.test(reviewer.prompt);
    expect(requiresFinalLine).toBe(true);
    expect(prompt).toContain("changes requested");
  });

  it("does NOT tell the reviewer to emit TEST FAILED or BUILD FAILED on review decisions", () => {
    // Reviewer must not contaminate review decisions with execution-failure markers,
    // which would land in TASK_ERROR_MARKERS and re-introduce the original bug.
    const prompt = reviewer.prompt;
    // It is OK to MENTION these markers in passing (e.g. quoting other agents),
    // but the prompt must NOT instruct the reviewer to produce them.
    const banner = "Status:";
    const idxStatus = prompt.indexOf(banner);
    if (idxStatus >= 0) {
      const block = prompt.slice(idxStatus, idxStatus + 200);
      expect(block).not.toMatch(/TEST FAILED/);
      expect(block).not.toMatch(/BUILD FAILED/);
    }
  });
});
```

Implementation — locate the existing reviewer status section (around lines 100-130 of the current file, which already has `Status: APPROVED / CHANGES REQUESTED`) and append a final-line-placement rule. Suggested text addition (the implementer is free to phrase, as long as the test assertions pass):

```text
<final-marker-rule priority="critical">
Your verdict MUST appear as the LAST line of your reply, on its own line, with no
trailing prose. Use exactly one of:

  APPROVED
  CHANGES REQUESTED: <one-line summary of required fixes>

Why this matters: the spawn_agent classifier treats `CHANGES REQUESTED` as a final
review decision ONLY when it is anchored at the start of a line. If the marker is
buried inside prose or fenced code, the result is routed through a slower
verification path. Keep the body of your review above; put the verdict last.

Do NOT emit `TEST FAILED` or `BUILD FAILED` from this agent — those markers are
reserved for implementer execution failures and will misroute your review.
</final-marker-rule>
```

Notes:
- This change preserves the existing review report structure documented elsewhere in the prompt (the long-form findings, file-by-file notes, severity, etc.). It only constrains the placement of the verdict line.
- The test deliberately does not pin the exact wording of the rule; only the structural anchor words.

**Verify:** `bun test tests/agents/reviewer-prompt.test.ts && bun run check`
**Commit:** `docs(reviewer): require final-line placement for APPROVED / CHANGES REQUESTED`
