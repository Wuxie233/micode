---
date: 2026-04-29
topic: "Restart-resumable lifecycle execution (Phase 1)"
issue: 10
scope: lifecycle
contract: none
---

# Restart-resumable Lifecycle Execution (Phase 1) Implementation Plan

**Goal:** Add lifecycle-scoped execution journal, executor lease, side-effect markers, and a conservative resume resolver so OpenCode restarts mid-batch can resume from durable checkpoints instead of guessing.

**Architecture:** Three new modules under `src/lifecycle/` (`journal/`, `lease/`, `recovery/`) plus a stable marker helper (`markers.ts`). Journal events live as JSONL appended next to each lifecycle JSON record. Leases live as a sibling JSON file with TTL + heartbeat. Existing `lifecycle/index.ts`, `commit-message.ts`, `progress.ts`, and `tools/lifecycle/` are extended to emit journal events and embed markers in commits and issue comments. The recovery inspector is read-only and returns a discriminated decision; only `decideRecovery` (a thin orchestrator) mutates state, and only after the inspection result is deterministic.

**Design:** [thoughts/shared/designs/2026-04-29-restart-resumable-lifecycle-execution-design.md](../designs/2026-04-29-restart-resumable-lifecycle-execution-design.md)

**Contract:** none (single-domain backend/general work, no frontend tasks)

**Out of scope (Phase 1):** spawn_agent registry persistence, Octto registry persistence, PTY orphan cleanup, separate worktree manifest. Those remain on the design's deferred list.

---

## Engineering decisions filling design gaps

The design states the WHAT but leaves the HOW open. The following choices are mine and apply to all batches below:

- **Journal storage:** JSONL append-only at `thoughts/lifecycle/<N>.journal.jsonl`. One JSON event per line. Sequence numbers are monotonic per-issue, derived from line count + 1 on each append. JSONL chosen over a single JSON array so concurrent appends never need a full rewrite and partial writes only corrupt the trailing line, which the loader tolerantly skips.
- **Lease storage:** Single JSON file at `thoughts/lifecycle/<N>.lease.json` with atomic write via temp-file + rename. TTL default 10 minutes (`config.lifecycle.leaseTtlMs = 600_000`), heartbeat default 60s (`config.lifecycle.leaseHeartbeatMs = 60_000`). A lease is "expired" when `now - heartbeatAt > ttlMs`.
- **Lease ownership identity:** `{ owner, host, branch, worktree }` where `owner` is a caller-provided string (the executor passes the OpenCode session id, fall back to `process.pid`).
- **Stable marker format:** A single line of the form `<!-- micode:lc issue=<N> batch=<id> task=<id> attempt=<n> seq=<m> -->`. Embedded into the trailing line of commit messages and as the leading line of progress comments. Parser is a single regex; missing fields parse as `null`.
- **Recovery decision shape:** Discriminated union `{ kind: "clean_resume" | "reconciled_resume" | "partial_resume" | "blocked", reason, ... }`. Inspection is pure (no fs writes). Application is a separate `applyRecoveryDecision` that journals the decision then writes the lease.
- **Backwards compatibility:** Existing lifecycle records without a journal load fine. The journal store returns `[]` when the JSONL is missing. The lease store returns `null` when the lease file is missing. Resolver short-circuits to `{ kind: "clean_resume" }` when there is no journal and no in-flight markers.
- **Origin / branch / worktree drift:** A new `recovery/identity.ts` helper reads current `git remote get-url origin` plus current branch and worktree top-level; the inspector compares those against the lifecycle record fields and refuses automatic resume on any mismatch. Reuses the existing `LifecycleRunner`.
- **Schema validation:** All new types validated with Valibot at system boundaries (`safeParse` on read). Mirrors the convention already in `src/lifecycle/schemas.ts`. No `any`. Extra fields rejected by `strictObject` for journal events; lease fields use plain `object` so future fields are tolerated.
- **Tests:** Each implementation file gets a sibling `tests/lifecycle/<area>/<file>.test.ts`. Filesystem tests use unique `mkdtempSync` paths under `tmpdir()` and clean up in `afterEach`, matching the pattern in `tests/lifecycle/store.test.ts`.

---

## Dependency Graph

```
Batch 1 (parallel - 7 tasks): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7   [foundation, no deps]
Batch 2 (parallel - 3 tasks): 2.1, 2.2, 2.3                       [stores + helpers, depends on batch 1]
Batch 3 (parallel - 3 tasks): 3.1, 3.2, 3.3                       [recovery inspector + marker injection, depends on batch 2]
Batch 4 (parallel - 2 tasks): 4.1, 4.2                            [lifecycle handle integration + new tool file, depends on batch 3]
Batch 5 (parallel - 3 tasks): 5.1, 5.2, 5.3                       [tool wiring + plugin wiring + integration test, depends on batch 4]
```

---

## Batch 1: Foundation (parallel - 7 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

### Task 1.1: Journal event types
**File:** `src/lifecycle/journal/types.ts`
**Test:** `tests/lifecycle/journal/types.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/lifecycle/journal/types.test.ts
import { describe, expect, it } from "bun:test";

import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";

describe("journal event types", () => {
  it("exposes the documented event kinds", () => {
    expect(Object.values(JOURNAL_EVENT_KINDS).sort()).toEqual([
      "batch_completed",
      "batch_dispatched",
      "commit_observed",
      "lease_acquired",
      "lease_released",
      "recovery_blocked",
      "recovery_inspected",
      "review_completed",
    ]);
  });

  it("each event kind narrows the JournalEvent union", () => {
    const event: JournalEvent = {
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      issueNumber: 10,
      seq: 1,
      at: 1_777_000_000_000,
      batchId: "1",
      taskId: null,
      attempt: 1,
      summary: "dispatched batch 1",
      commitMarker: null,
      reviewOutcome: null,
    };
    expect(event.kind).toBe("batch_dispatched");
  });
});
```

```typescript
// src/lifecycle/journal/types.ts
export const JOURNAL_EVENT_KINDS = {
  BATCH_DISPATCHED: "batch_dispatched",
  BATCH_COMPLETED: "batch_completed",
  REVIEW_COMPLETED: "review_completed",
  COMMIT_OBSERVED: "commit_observed",
  LEASE_ACQUIRED: "lease_acquired",
  LEASE_RELEASED: "lease_released",
  RECOVERY_INSPECTED: "recovery_inspected",
  RECOVERY_BLOCKED: "recovery_blocked",
} as const;

export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[keyof typeof JOURNAL_EVENT_KINDS];

export interface JournalEvent {
  readonly kind: JournalEventKind;
  readonly issueNumber: number;
  readonly seq: number;
  readonly at: number;
  readonly batchId: string | null;
  readonly taskId: string | null;
  readonly attempt: number;
  readonly summary: string;
  readonly commitMarker: string | null;
  readonly reviewOutcome: "approved" | "changes_requested" | "blocked" | null;
}

export interface JournalEventInput {
  readonly kind: JournalEventKind;
  readonly batchId?: string | null;
  readonly taskId?: string | null;
  readonly attempt?: number;
  readonly summary: string;
  readonly commitMarker?: string | null;
  readonly reviewOutcome?: JournalEvent["reviewOutcome"];
}
```

**Verify:** `bun test tests/lifecycle/journal/types.test.ts`
**Commit:** `feat(lifecycle): add journal event types`

### Task 1.2: Journal Valibot schemas
**File:** `src/lifecycle/journal/schemas.ts`
**Test:** `tests/lifecycle/journal/schemas.test.ts`
**Depends:** none (uses 1.1 types via type-only import; ok in same batch because schemas.ts redeclares structure independently)
**Domain:** general

> Note: `import type` is type-only and is erased at runtime, so this task can compile in parallel with 1.1. The implementer must use `import type { JournalEventKind } from "./types"` only.

```typescript
// tests/lifecycle/journal/schemas.test.ts
import { describe, expect, it } from "bun:test";

import { JournalEventSchema, parseJournalEvent } from "@/lifecycle/journal/schemas";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import * as v from "valibot";

const baseEvent = {
  kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
  issueNumber: 10,
  seq: 1,
  at: 1_777_000_000_000,
  batchId: "1",
  taskId: null,
  attempt: 1,
  summary: "dispatched",
  commitMarker: null,
  reviewOutcome: null,
};

describe("journal schemas", () => {
  it("accepts a valid event", () => {
    expect(v.safeParse(JournalEventSchema, baseEvent).success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    const result = parseJournalEvent({ ...baseEvent, kind: "made_up" });
    expect(result.ok).toBe(false);
  });

  it("rejects negative seq", () => {
    const result = parseJournalEvent({ ...baseEvent, seq: -1 });
    expect(result.ok).toBe(false);
  });

  it("returns informative issues", () => {
    const result = parseJournalEvent({ ...baseEvent, issueNumber: "ten" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((m) => m.includes("issueNumber"))).toBe(true);
  });
});
```

```typescript
// src/lifecycle/journal/schemas.ts
import * as v from "valibot";

import { type JournalEventKind, JOURNAL_EVENT_KINDS } from "./types";

const ROOT_PATH = "event";
const PATH_SEPARATOR = ".";

const KindSchema = v.picklist(Object.values(JOURNAL_EVENT_KINDS) as readonly JournalEventKind[]);
const ReviewOutcomeSchema = v.nullable(v.picklist(["approved", "changes_requested", "blocked"] as const));

export const JournalEventSchema = v.strictObject({
  kind: KindSchema,
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  seq: v.pipe(v.number(), v.minValue(0)),
  at: v.number(),
  batchId: v.nullable(v.string()),
  taskId: v.nullable(v.string()),
  attempt: v.pipe(v.number(), v.minValue(0)),
  summary: v.string(),
  commitMarker: v.nullable(v.string()),
  reviewOutcome: ReviewOutcomeSchema,
});

export type JournalEventParsed = v.InferOutput<typeof JournalEventSchema>;

const formatPath = (issue: v.BaseIssue<unknown>): string => {
  const path = issue.path?.map((item) => String(item.key)).join(PATH_SEPARATOR);
  return path && path.length > 0 ? path : ROOT_PATH;
};

const formatIssue = (issue: v.BaseIssue<unknown>): string => `${formatPath(issue)}: ${issue.message}`;

export function parseJournalEvent(
  raw: unknown,
): { ok: true; event: JournalEventParsed } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(JournalEventSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, event: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
```

**Verify:** `bun test tests/lifecycle/journal/schemas.test.ts`
**Commit:** `feat(lifecycle): add journal event valibot schemas`

### Task 1.3: Lease record types
**File:** `src/lifecycle/lease/types.ts`
**Test:** `tests/lifecycle/lease/types.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/lifecycle/lease/types.test.ts
import { describe, expect, it } from "bun:test";

import type { LeaseRecord } from "@/lifecycle/lease/types";

describe("lease types", () => {
  it("compiles a canonical lease", () => {
    const lease: LeaseRecord = {
      issueNumber: 10,
      owner: "session-abc",
      host: "host-xyz",
      branch: "issue/10-feature",
      worktree: "/tmp/wt",
      acquiredAt: 1_777_000_000_000,
      heartbeatAt: 1_777_000_001_000,
      ttlMs: 600_000,
    };
    expect(lease.owner).toBe("session-abc");
  });
});
```

```typescript
// src/lifecycle/lease/types.ts
export interface LeaseRecord {
  readonly issueNumber: number;
  readonly owner: string;
  readonly host: string;
  readonly branch: string;
  readonly worktree: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
  readonly ttlMs: number;
}

export interface LeaseAcquireInput {
  readonly issueNumber: number;
  readonly owner: string;
  readonly host: string;
  readonly branch: string;
  readonly worktree: string;
  readonly ttlMs: number;
}

export type LeaseAcquireOutcome =
  | { readonly kind: "acquired"; readonly lease: LeaseRecord }
  | { readonly kind: "held"; readonly current: LeaseRecord }
  | { readonly kind: "expired_stolen"; readonly lease: LeaseRecord; readonly previous: LeaseRecord };
```

**Verify:** `bun test tests/lifecycle/lease/types.test.ts`
**Commit:** `feat(lifecycle): add lease record types`

### Task 1.4: Lease Valibot schemas
**File:** `src/lifecycle/lease/schemas.ts`
**Test:** `tests/lifecycle/lease/schemas.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/lifecycle/lease/schemas.test.ts
import { describe, expect, it } from "bun:test";

import { LeaseRecordSchema, parseLeaseRecord } from "@/lifecycle/lease/schemas";
import * as v from "valibot";

const valid = {
  issueNumber: 10,
  owner: "session-abc",
  host: "host-xyz",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  acquiredAt: 1_777_000_000_000,
  heartbeatAt: 1_777_000_001_000,
  ttlMs: 600_000,
};

describe("lease schemas", () => {
  it("accepts a valid lease", () => {
    expect(v.safeParse(LeaseRecordSchema, valid).success).toBe(true);
  });

  it("rejects negative ttl", () => {
    const result = parseLeaseRecord({ ...valid, ttlMs: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects empty owner", () => {
    const result = parseLeaseRecord({ ...valid, owner: "" });
    expect(result.ok).toBe(false);
  });
});
```

```typescript
// src/lifecycle/lease/schemas.ts
import * as v from "valibot";

const ROOT_PATH = "lease";
const PATH_SEPARATOR = ".";

export const LeaseRecordSchema = v.object({
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  owner: v.pipe(v.string(), v.minLength(1)),
  host: v.string(),
  branch: v.pipe(v.string(), v.minLength(1)),
  worktree: v.pipe(v.string(), v.minLength(1)),
  acquiredAt: v.number(),
  heartbeatAt: v.number(),
  ttlMs: v.pipe(v.number(), v.minValue(0)),
});

export type LeaseRecordParsed = v.InferOutput<typeof LeaseRecordSchema>;

const formatPath = (issue: v.BaseIssue<unknown>): string => {
  const path = issue.path?.map((item) => String(item.key)).join(PATH_SEPARATOR);
  return path && path.length > 0 ? path : ROOT_PATH;
};

const formatIssue = (issue: v.BaseIssue<unknown>): string => `${formatPath(issue)}: ${issue.message}`;

export function parseLeaseRecord(
  raw: unknown,
): { ok: true; lease: LeaseRecordParsed } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(LeaseRecordSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, lease: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
```

**Verify:** `bun test tests/lifecycle/lease/schemas.test.ts`
**Commit:** `feat(lifecycle): add lease record valibot schemas`

### Task 1.5: Stable side-effect markers
**File:** `src/lifecycle/markers.ts`
**Test:** `tests/lifecycle/markers.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/lifecycle/markers.test.ts
import { describe, expect, it } from "bun:test";

import { buildExecutionMarker, isExecutionMarker, parseExecutionMarker } from "@/lifecycle/markers";

describe("execution markers", () => {
  it("round trips a populated marker", () => {
    const text = buildExecutionMarker({
      issueNumber: 10,
      batchId: "2",
      taskId: "2.3",
      attempt: 1,
      seq: 7,
    });
    expect(text).toBe("<!-- micode:lc issue=10 batch=2 task=2.3 attempt=1 seq=7 -->");

    const parsed = parseExecutionMarker(text);
    expect(parsed).toEqual({
      issueNumber: 10,
      batchId: "2",
      taskId: "2.3",
      attempt: 1,
      seq: 7,
    });
  });

  it("tolerates missing optional fields when parsing", () => {
    const parsed = parseExecutionMarker("<!-- micode:lc issue=10 attempt=0 seq=0 -->");
    expect(parsed).toEqual({ issueNumber: 10, batchId: null, taskId: null, attempt: 0, seq: 0 });
  });

  it("returns null for unrelated comments", () => {
    expect(parseExecutionMarker("<!-- something else -->")).toBeNull();
    expect(parseExecutionMarker("not a marker")).toBeNull();
  });

  it("isExecutionMarker matches embedded markers in larger strings", () => {
    const body = "Commit message body\n\n<!-- micode:lc issue=10 batch=1 attempt=1 seq=1 -->";
    expect(isExecutionMarker(body)).toBe(true);
  });

  it("rejects when issueNumber is missing", () => {
    expect(parseExecutionMarker("<!-- micode:lc batch=1 attempt=1 seq=1 -->")).toBeNull();
  });
});
```

```typescript
// src/lifecycle/markers.ts
const MARKER_REGEX = /<!--\s*micode:lc\s+([^>]*?)\s*-->/;
const FIELD_REGEX = /(\w+)=([^\s]+)/g;
const DECIMAL_RADIX = 10;

export interface ExecutionMarker {
  readonly issueNumber: number;
  readonly batchId: string | null;
  readonly taskId: string | null;
  readonly attempt: number;
  readonly seq: number;
}

export interface ExecutionMarkerInput {
  readonly issueNumber: number;
  readonly batchId?: string | null;
  readonly taskId?: string | null;
  readonly attempt: number;
  readonly seq: number;
}

const renderField = (key: string, value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return `${key}=${value}`;
};

export function buildExecutionMarker(input: ExecutionMarkerInput): string {
  const fields = [
    renderField("issue", input.issueNumber),
    renderField("batch", input.batchId ?? null),
    renderField("task", input.taskId ?? null),
    renderField("attempt", input.attempt),
    renderField("seq", input.seq),
  ].filter((piece): piece is string => piece !== null);
  return `<!-- micode:lc ${fields.join(" ")} -->`;
}

const parseInt10 = (value: string): number | null => {
  const parsed = Number.parseInt(value, DECIMAL_RADIX);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseExecutionMarker(text: string): ExecutionMarker | null {
  const match = MARKER_REGEX.exec(text);
  if (!match) return null;
  const body = match[1] ?? "";
  const fields = new Map<string, string>();
  for (const fieldMatch of body.matchAll(FIELD_REGEX)) {
    const key = fieldMatch[1];
    const value = fieldMatch[2];
    if (key && value) fields.set(key, value);
  }
  const issueRaw = fields.get("issue");
  const issueNumber = issueRaw ? parseInt10(issueRaw) : null;
  if (issueNumber === null || issueNumber <= 0) return null;
  const attempt = parseInt10(fields.get("attempt") ?? "0") ?? 0;
  const seq = parseInt10(fields.get("seq") ?? "0") ?? 0;
  return {
    issueNumber,
    batchId: fields.get("batch") ?? null,
    taskId: fields.get("task") ?? null,
    attempt,
    seq,
  };
}

export function isExecutionMarker(text: string): boolean {
  return MARKER_REGEX.test(text);
}
```

**Verify:** `bun test tests/lifecycle/markers.test.ts`
**Commit:** `feat(lifecycle): add stable execution side-effect markers`

### Task 1.6: Recovery decision types
**File:** `src/lifecycle/recovery/types.ts`
**Test:** `tests/lifecycle/recovery/types.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/lifecycle/recovery/types.test.ts
import { describe, expect, it } from "bun:test";

import { RECOVERY_DECISION_KINDS, type RecoveryDecision } from "@/lifecycle/recovery/types";

describe("recovery decision types", () => {
  it("exposes the documented decision kinds", () => {
    expect(Object.values(RECOVERY_DECISION_KINDS).sort()).toEqual([
      "blocked",
      "clean_resume",
      "partial_resume",
      "reconciled_resume",
    ]);
  });

  it("compiles a blocked decision", () => {
    const decision: RecoveryDecision = {
      kind: RECOVERY_DECISION_KINDS.BLOCKED,
      reason: "branch_mismatch",
      detail: "expected issue/10-x, found main",
      lastSeq: 4,
    };
    expect(decision.kind).toBe("blocked");
  });

  it("compiles a reconciled resume decision", () => {
    const decision: RecoveryDecision = {
      kind: RECOVERY_DECISION_KINDS.RECONCILED_RESUME,
      backfilledBatches: ["1", "2"],
      nextBatchId: "3",
      lastSeq: 7,
    };
    expect(decision.backfilledBatches).toEqual(["1", "2"]);
  });
});
```

```typescript
// src/lifecycle/recovery/types.ts
export const RECOVERY_DECISION_KINDS = {
  CLEAN_RESUME: "clean_resume",
  RECONCILED_RESUME: "reconciled_resume",
  PARTIAL_RESUME: "partial_resume",
  BLOCKED: "blocked",
} as const;

export type RecoveryDecisionKind = (typeof RECOVERY_DECISION_KINDS)[keyof typeof RECOVERY_DECISION_KINDS];

export type RecoveryBlockReason =
  | "branch_mismatch"
  | "worktree_mismatch"
  | "origin_mismatch"
  | "lease_active"
  | "needs_reconcile"
  | "issue_closed"
  | "journal_corrupt"
  | "no_lifecycle";

export interface CleanResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.CLEAN_RESUME;
  readonly nextBatchId: string | null;
  readonly lastSeq: number;
}

export interface ReconciledResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.RECONCILED_RESUME;
  readonly backfilledBatches: readonly string[];
  readonly nextBatchId: string | null;
  readonly lastSeq: number;
}

export interface PartialResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.PARTIAL_RESUME;
  readonly completedBatches: readonly string[];
  readonly pendingBatchId: string;
  readonly note: string;
  readonly lastSeq: number;
}

export interface BlockedDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.BLOCKED;
  readonly reason: RecoveryBlockReason;
  readonly detail: string;
  readonly lastSeq: number;
}

export type RecoveryDecision =
  | CleanResumeDecision
  | ReconciledResumeDecision
  | PartialResumeDecision
  | BlockedDecision;
```

**Verify:** `bun test tests/lifecycle/recovery/types.test.ts`
**Commit:** `feat(lifecycle): add recovery decision types`

### Task 1.7: Configuration additions for journal and lease
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config-lifecycle-journal.test.ts`
**Depends:** none
**Domain:** general

> Modify the existing `lifecycle:` block in-place. Add four keys: `journalSuffix`, `leaseSuffix`, `leaseTtlMs`, `leaseHeartbeatMs`. Do not change any existing key. The implementer MUST preserve the surrounding block exactly and only insert these four keys after `lifecycleDir`.

```typescript
// tests/utils/config-lifecycle-journal.test.ts
import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("lifecycle journal/lease config", () => {
  it("exposes journal and lease suffix defaults", () => {
    expect(config.lifecycle.journalSuffix).toBe(".journal.jsonl");
    expect(config.lifecycle.leaseSuffix).toBe(".lease.json");
  });

  it("exposes lease ttl and heartbeat defaults", () => {
    expect(config.lifecycle.leaseTtlMs).toBe(600_000);
    expect(config.lifecycle.leaseHeartbeatMs).toBe(60_000);
  });

  it("preserves existing lifecycle keys", () => {
    expect(config.lifecycle.lifecycleDir).toBe("thoughts/lifecycle");
    expect(config.lifecycle.autoPush).toBe(true);
  });
});
```

```typescript
// PARTIAL EDIT to src/utils/config.ts (within the existing lifecycle: block)
//
// BEFORE (existing block, do not change keys above lifecycleDir):
//   lifecycle: {
//     autoPush: true,
//     mergeStrategy: "auto" as "auto" | "pr" | "local-merge",
//     failedSessionTtlHours: 24,
//     pushRetryBackoffMs: 5000,
//     prCheckTimeoutMs: 600_000,
//     lifecycleDir: "thoughts/lifecycle",
//   },
//
// AFTER:
  lifecycle: {
    autoPush: true,
    mergeStrategy: "auto" as "auto" | "pr" | "local-merge",
    failedSessionTtlHours: 24,
    pushRetryBackoffMs: 5000,
    prCheckTimeoutMs: 600_000,
    lifecycleDir: "thoughts/lifecycle",
    journalSuffix: ".journal.jsonl",
    leaseSuffix: ".lease.json",
    leaseTtlMs: 600_000,
    leaseHeartbeatMs: 60_000,
  },
```

**Verify:** `bun test tests/utils/config-lifecycle-journal.test.ts`
**Commit:** `feat(lifecycle): expose journal and lease config defaults`

---

## Batch 2: Stores and helpers (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Journal store (JSONL append-only)
**File:** `src/lifecycle/journal/store.ts`
**Test:** `tests/lifecycle/journal/store.test.ts`
**Depends:** 1.1, 1.2, 1.7
**Domain:** backend

```typescript
// tests/lifecycle/journal/store.test.ts
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";

const ISSUE = 10;

describe("journal store", () => {
  let baseDir: string;
  let warning: ReturnType<typeof spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-journal-"));
    warning = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warning.mockRestore();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns empty list when no journal exists", async () => {
    const store = createJournalStore({ baseDir });
    await expect(store.list(ISSUE)).resolves.toEqual([]);
    await expect(store.lastSeq(ISSUE)).resolves.toBe(0);
  });

  it("appends events with monotonic seq", async () => {
    const store = createJournalStore({ baseDir });
    const first = await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      summary: "batch 1",
      batchId: "1",
      attempt: 1,
    });
    const second = await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
      summary: "batch 1 done",
      batchId: "1",
      attempt: 1,
    });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    const events = await store.list(ISSUE);
    expect(events.map((event) => event.kind)).toEqual([
      JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
    ]);
    await expect(store.lastSeq(ISSUE)).resolves.toBe(2);
  });

  it("skips malformed lines and warns", async () => {
    const store = createJournalStore({ baseDir });
    await store.append(ISSUE, { kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, summary: "ok", batchId: "1", attempt: 1 });
    writeFileSync(join(baseDir, `${ISSUE}.journal.jsonl`), `${"{not json"}\n`, { flag: "a" });
    await store.append(ISSUE, { kind: JOURNAL_EVENT_KINDS.BATCH_COMPLETED, summary: "ok2", batchId: "1", attempt: 1 });
    const events = await store.list(ISSUE);
    expect(events).toHaveLength(2);
    expect(warning).toHaveBeenCalled();
  });

  it("rejects invalid issue numbers", async () => {
    const store = createJournalStore({ baseDir });
    await expect(
      store.append(0, { kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, summary: "x", batchId: null, attempt: 0 }),
    ).rejects.toThrow(/Invalid issue/);
  });
});
```

```typescript
// src/lifecycle/journal/store.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { parseJournalEvent } from "./schemas";
import type { JournalEvent, JournalEventInput } from "./types";

const LOG_SCOPE = "lifecycle.journal";
const MIN_ISSUE_NUMBER = 1;
const NEWLINE = "\n";

export interface JournalStoreOptions {
  readonly baseDir?: string;
  readonly suffix?: string;
  readonly now?: () => number;
}

export interface JournalStore {
  readonly append: (issueNumber: number, input: JournalEventInput) => Promise<JournalEvent>;
  readonly list: (issueNumber: number) => Promise<readonly JournalEvent[]>;
  readonly lastSeq: (issueNumber: number) => Promise<number>;
}

const validateIssueNumber = (issueNumber: number): void => {
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return;
  throw new Error(`Invalid issue number: ${issueNumber}`);
};

const ensureDir = (dir: string): void => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
};

const readEvents = (path: string): readonly JournalEvent[] => {
  if (!existsSync(path)) return [];
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    log.warn(LOG_SCOPE, `read failed: ${path}: ${extractErrorMessage(error)}`);
    return [];
  }
  const events: JournalEvent[] = [];
  for (const line of content.split(NEWLINE)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      log.warn(LOG_SCOPE, `malformed journal line in ${path}: ${extractErrorMessage(error)}`);
      continue;
    }
    const parsed = parseJournalEvent(raw);
    if (!parsed.ok) {
      log.warn(LOG_SCOPE, `invalid journal entry in ${path}: ${parsed.issues.join("; ")}`);
      continue;
    }
    events.push(parsed.event);
  }
  return events;
};

export function createJournalStore(options: JournalStoreOptions = {}): JournalStore {
  const baseDir = options.baseDir ?? config.lifecycle.lifecycleDir;
  const suffix = options.suffix ?? config.lifecycle.journalSuffix;
  const now = options.now ?? Date.now;

  const pathFor = (issueNumber: number): string => {
    validateIssueNumber(issueNumber);
    return join(baseDir, `${issueNumber}${suffix}`);
  };

  const lastSeqFor = (issueNumber: number): number => {
    const events = readEvents(pathFor(issueNumber));
    if (events.length === 0) return 0;
    return events[events.length - 1]?.seq ?? 0;
  };

  return {
    async append(issueNumber, input) {
      ensureDir(baseDir);
      const path = pathFor(issueNumber);
      const seq = lastSeqFor(issueNumber) + 1;
      const event: JournalEvent = {
        kind: input.kind,
        issueNumber,
        seq,
        at: now(),
        batchId: input.batchId ?? null,
        taskId: input.taskId ?? null,
        attempt: input.attempt ?? 0,
        summary: input.summary,
        commitMarker: input.commitMarker ?? null,
        reviewOutcome: input.reviewOutcome ?? null,
      };
      appendFileSync(path, `${JSON.stringify(event)}${NEWLINE}`);
      return event;
    },

    async list(issueNumber) {
      return readEvents(pathFor(issueNumber));
    },

    async lastSeq(issueNumber) {
      return lastSeqFor(issueNumber);
    },
  };
}
```

**Verify:** `bun test tests/lifecycle/journal/store.test.ts`
**Commit:** `feat(lifecycle): add jsonl journal store`

### Task 2.2: Lease store (acquire / heartbeat / release)
**File:** `src/lifecycle/lease/store.ts`
**Test:** `tests/lifecycle/lease/store.test.ts`
**Depends:** 1.3, 1.4, 1.7
**Domain:** backend

```typescript
// tests/lifecycle/lease/store.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLeaseStore } from "@/lifecycle/lease/store";

const ISSUE = 10;
const TTL = 60_000;

const baseInput = {
  issueNumber: ISSUE,
  owner: "session-a",
  host: "host-1",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  ttlMs: TTL,
};

describe("lease store", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-lease-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns null when no lease exists", async () => {
    const store = createLeaseStore({ baseDir });
    await expect(store.load(ISSUE)).resolves.toBeNull();
  });

  it("acquires a fresh lease", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    const outcome = await store.acquire(baseInput);
    expect(outcome.kind).toBe("acquired");
    if (outcome.kind === "acquired") expect(outcome.lease.owner).toBe("session-a");
    clock += 5_000;
    const loaded = await store.load(ISSUE);
    expect(loaded?.heartbeatAt).toBe(1_000);
  });

  it("returns held when an unexpired lease is owned by someone else", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += 1_000;
    const second = await store.acquire({ ...baseInput, owner: "session-b" });
    expect(second.kind).toBe("held");
  });

  it("steals an expired lease", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += TTL * 2;
    const second = await store.acquire({ ...baseInput, owner: "session-b" });
    expect(second.kind).toBe("expired_stolen");
    if (second.kind === "expired_stolen") expect(second.lease.owner).toBe("session-b");
  });

  it("heartbeat refreshes heartbeatAt for the owner", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += 5_000;
    const refreshed = await store.heartbeat(ISSUE, "session-a");
    expect(refreshed?.heartbeatAt).toBe(6_000);
  });

  it("heartbeat returns null when owner mismatches", async () => {
    const store = createLeaseStore({ baseDir });
    await store.acquire(baseInput);
    await expect(store.heartbeat(ISSUE, "intruder")).resolves.toBeNull();
  });

  it("release removes the lease only if owner matches", async () => {
    const store = createLeaseStore({ baseDir });
    await store.acquire(baseInput);
    await expect(store.release(ISSUE, "intruder")).resolves.toBe(false);
    await expect(store.release(ISSUE, "session-a")).resolves.toBe(true);
    await expect(store.load(ISSUE)).resolves.toBeNull();
  });
});
```

```typescript
// src/lifecycle/lease/store.ts
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { parseLeaseRecord } from "./schemas";
import type { LeaseAcquireInput, LeaseAcquireOutcome, LeaseRecord } from "./types";

const LOG_SCOPE = "lifecycle.lease";
const MIN_ISSUE_NUMBER = 1;
const TEMP_SUFFIX = ".tmp";
const JSON_INDENT = 2;

export interface LeaseStoreOptions {
  readonly baseDir?: string;
  readonly suffix?: string;
  readonly now?: () => number;
}

export interface LeaseStore {
  readonly acquire: (input: LeaseAcquireInput) => Promise<LeaseAcquireOutcome>;
  readonly heartbeat: (issueNumber: number, owner: string) => Promise<LeaseRecord | null>;
  readonly release: (issueNumber: number, owner: string) => Promise<boolean>;
  readonly load: (issueNumber: number) => Promise<LeaseRecord | null>;
}

const validateIssueNumber = (issueNumber: number): void => {
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return;
  throw new Error(`Invalid issue number: ${issueNumber}`);
};

const ensureDir = (dir: string): void => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
};

const readLease = (path: string): LeaseRecord | null => {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Bun.file(path).text() as unknown as string);
  } catch {
    // Bun.file().text() returns a Promise so use sync fallback below.
    raw = null;
  }
  if (raw === null) {
    try {
      raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    } catch (error) {
      log.warn(LOG_SCOPE, `malformed lease ${path}: ${extractErrorMessage(error)}`);
      return null;
    }
  }
  const parsed = parseLeaseRecord(raw);
  if (!parsed.ok) {
    log.warn(LOG_SCOPE, `invalid lease ${path}: ${parsed.issues.join("; ")}`);
    return null;
  }
  return parsed.lease;
};

const writeLease = (path: string, lease: LeaseRecord): void => {
  const tempPath = `${path}${TEMP_SUFFIX}`;
  writeFileSync(tempPath, JSON.stringify(lease, null, JSON_INDENT));
  renameSync(tempPath, path);
};

const isExpired = (lease: LeaseRecord, now: number): boolean => now - lease.heartbeatAt > lease.ttlMs;

export function createLeaseStore(options: LeaseStoreOptions = {}): LeaseStore {
  const baseDir = options.baseDir ?? config.lifecycle.lifecycleDir;
  const suffix = options.suffix ?? config.lifecycle.leaseSuffix;
  const now = options.now ?? Date.now;

  const pathFor = (issueNumber: number): string => {
    validateIssueNumber(issueNumber);
    return join(baseDir, `${issueNumber}${suffix}`);
  };

  return {
    async acquire(input) {
      ensureDir(baseDir);
      const path = pathFor(input.issueNumber);
      const current = readLease(path);
      const at = now();
      const fresh: LeaseRecord = {
        issueNumber: input.issueNumber,
        owner: input.owner,
        host: input.host,
        branch: input.branch,
        worktree: input.worktree,
        acquiredAt: at,
        heartbeatAt: at,
        ttlMs: input.ttlMs,
      };
      if (current === null) {
        writeLease(path, fresh);
        return { kind: "acquired", lease: fresh };
      }
      if (current.owner === input.owner) {
        const refreshed: LeaseRecord = { ...current, heartbeatAt: at, ttlMs: input.ttlMs };
        writeLease(path, refreshed);
        return { kind: "acquired", lease: refreshed };
      }
      if (!isExpired(current, at)) return { kind: "held", current };
      writeLease(path, fresh);
      return { kind: "expired_stolen", lease: fresh, previous: current };
    },

    async heartbeat(issueNumber, owner) {
      const path = pathFor(issueNumber);
      const current = readLease(path);
      if (!current) return null;
      if (current.owner !== owner) return null;
      const refreshed: LeaseRecord = { ...current, heartbeatAt: now() };
      writeLease(path, refreshed);
      return refreshed;
    },

    async release(issueNumber, owner) {
      const path = pathFor(issueNumber);
      const current = readLease(path);
      if (!current) return false;
      if (current.owner !== owner) return false;
      rmSync(path, { force: true });
      return true;
    },

    async load(issueNumber) {
      return readLease(pathFor(issueNumber));
    },
  };
}
```

> Note for the implementer: the use of `require("node:fs").readFileSync` inside `readLease` is a deliberate sync fallback because Bun.file is async and a sync read keeps the lease store interface simple. Replace it with `readFileSync` imported at the top if cleaner; the test suite covers behavior, not the implementation detail.

**Verify:** `bun test tests/lifecycle/lease/store.test.ts`
**Commit:** `feat(lifecycle): add lease store with ttl and heartbeat`

### Task 2.3: Identity helper (origin / branch / worktree probe)
**File:** `src/lifecycle/recovery/identity.ts`
**Test:** `tests/lifecycle/recovery/identity.test.ts`
**Depends:** none structurally; uses `LifecycleRunner` from existing `runner.ts`
**Domain:** backend

```typescript
// tests/lifecycle/recovery/identity.test.ts
import { describe, expect, it } from "bun:test";

import { probeRuntimeIdentity } from "@/lifecycle/recovery/identity";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (): RunResult => ({ stdout: "", stderr: "boom", exitCode: 1 });

const createRunner = (overrides: {
  branch?: RunResult;
  origin?: RunResult;
  toplevel?: RunResult;
}): LifecycleRunner => ({
  async git(args) {
    if (args.includes("--abbrev-ref")) return overrides.branch ?? ok("issue/10-feature\n");
    if (args.includes("get-url")) return overrides.origin ?? ok("git@github.com:Wuxie233/micode.git\n");
    if (args.includes("--show-toplevel")) return overrides.toplevel ?? ok("/tmp/wt\n");
    return ok();
  },
  async gh() {
    return ok();
  },
});

describe("probeRuntimeIdentity", () => {
  it("returns trimmed values when all probes succeed", async () => {
    const identity = await probeRuntimeIdentity(createRunner({}), "/tmp/wt");
    expect(identity).toEqual({
      branch: "issue/10-feature",
      origin: "git@github.com:Wuxie233/micode.git",
      worktree: "/tmp/wt",
    });
  });

  it("returns null fields when probes fail", async () => {
    const identity = await probeRuntimeIdentity(
      createRunner({ branch: fail(), origin: fail(), toplevel: fail() }),
      "/tmp/wt",
    );
    expect(identity).toEqual({ branch: null, origin: null, worktree: "/tmp/wt" });
  });
});
```

```typescript
// src/lifecycle/recovery/identity.ts
import type { LifecycleRunner } from "../runner";

const OK_EXIT = 0;
const BRANCH_ARGS = ["rev-parse", "--abbrev-ref", "HEAD"] as const;
const ORIGIN_ARGS = ["remote", "get-url", "origin"] as const;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;

export interface RuntimeIdentity {
  readonly branch: string | null;
  readonly origin: string | null;
  readonly worktree: string;
}

const stdoutOrNull = (run: { stdout: string; exitCode: number }): string | null => {
  if (run.exitCode !== OK_EXIT) return null;
  const trimmed = run.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function probeRuntimeIdentity(runner: LifecycleRunner, fallbackWorktree: string): Promise<RuntimeIdentity> {
  const [branchRun, originRun, toplevelRun] = await Promise.all([
    runner.git(BRANCH_ARGS, { cwd: fallbackWorktree }),
    runner.git(ORIGIN_ARGS, { cwd: fallbackWorktree }),
    runner.git(TOPLEVEL_ARGS, { cwd: fallbackWorktree }),
  ]);

  return {
    branch: stdoutOrNull(branchRun),
    origin: stdoutOrNull(originRun),
    worktree: stdoutOrNull(toplevelRun) ?? fallbackWorktree,
  };
}
```

**Verify:** `bun test tests/lifecycle/recovery/identity.test.ts`
**Commit:** `feat(lifecycle): add runtime identity probe for recovery`

---

## Batch 3: Recovery inspector and marker injection (parallel - 3 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3

### Task 3.1: Recovery inspector (read-only decision producer)
**File:** `src/lifecycle/recovery/inspect.ts`
**Test:** `tests/lifecycle/recovery/inspect.test.ts`
**Depends:** 1.6, 2.1, 2.2, 2.3
**Domain:** backend

```typescript
// tests/lifecycle/recovery/inspect.test.ts
import { describe, expect, it } from "bun:test";

import { inspectRecovery, type RecoveryInspectorDeps } from "@/lifecycle/recovery/inspect";
import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";
import type { LeaseRecord } from "@/lifecycle/lease/types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const ISSUE = 10;
const NOW = 5_000_000;

const baseRecord: LifecycleRecord = {
  issueNumber: ISSUE,
  issueUrl: "https://github.com/Wuxie233/micode/issues/10",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: 0,
};

const event = (kind: JournalEvent["kind"], seq: number, batchId: string | null = "1"): JournalEvent => ({
  kind,
  issueNumber: ISSUE,
  seq,
  at: 1_000 + seq,
  batchId,
  taskId: null,
  attempt: 1,
  summary: "x",
  commitMarker: null,
  reviewOutcome: null,
});

const lease = (overrides: Partial<LeaseRecord> = {}): LeaseRecord => ({
  issueNumber: ISSUE,
  owner: "session-a",
  host: "host-1",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  acquiredAt: NOW - 1_000,
  heartbeatAt: NOW - 1_000,
  ttlMs: 60_000,
  ...overrides,
});

const makeDeps = (overrides: Partial<RecoveryInspectorDeps> = {}): RecoveryInspectorDeps => ({
  record: baseRecord,
  events: [],
  currentLease: null,
  identity: { branch: "issue/10-feature", origin: "git@github.com:Wuxie233/micode.git", worktree: "/tmp/wt" },
  expectedOrigin: "git@github.com:Wuxie233/micode.git",
  now: NOW,
  ...overrides,
});

describe("inspectRecovery", () => {
  it("returns clean_resume when there are no events and identity matches", () => {
    const decision = inspectRecovery(makeDeps());
    expect(decision.kind).toBe("clean_resume");
  });

  it("blocks on branch mismatch", () => {
    const decision = inspectRecovery(makeDeps({ identity: { branch: "main", origin: "git@github.com:Wuxie233/micode.git", worktree: "/tmp/wt" } }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "branch_mismatch" });
  });

  it("blocks on worktree mismatch", () => {
    const decision = inspectRecovery(makeDeps({ identity: { branch: "issue/10-feature", origin: "git@github.com:Wuxie233/micode.git", worktree: "/tmp/other" } }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "worktree_mismatch" });
  });

  it("blocks on origin mismatch when expected origin is provided", () => {
    const decision = inspectRecovery(makeDeps({ identity: { branch: "issue/10-feature", origin: "git@github.com:fork/repo.git", worktree: "/tmp/wt" } }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "origin_mismatch" });
  });

  it("blocks when an unexpired lease is held by another owner", () => {
    const held = lease({ owner: "session-b", heartbeatAt: NOW - 1_000 });
    const decision = inspectRecovery(makeDeps({ currentLease: held }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "lease_active" });
  });

  it("treats expired lease as resumable", () => {
    const stale = lease({ owner: "session-b", heartbeatAt: NOW - 60_000 - 1 });
    const decision = inspectRecovery(makeDeps({ currentLease: stale }));
    expect(decision.kind).toBe("clean_resume");
  });

  it("returns reconciled_resume when batch_dispatched has no matching completed and a commit_observed event closes the loop", () => {
    const events = [
      event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 1),
      event(JOURNAL_EVENT_KINDS.COMMIT_OBSERVED, 2),
    ];
    const decision = inspectRecovery(makeDeps({ events }));
    expect(decision.kind).toBe("reconciled_resume");
    if (decision.kind === "reconciled_resume") expect(decision.backfilledBatches).toEqual(["1"]);
  });

  it("returns partial_resume when a dispatched batch has no completion and no commit", () => {
    const events = [event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 1)];
    const decision = inspectRecovery(makeDeps({ events }));
    expect(decision.kind).toBe("partial_resume");
    if (decision.kind === "partial_resume") expect(decision.pendingBatchId).toBe("1");
  });

  it("blocks when journal sequence is not strictly increasing", () => {
    const events = [
      event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 2),
      event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 1),
    ];
    const decision = inspectRecovery(makeDeps({ events }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "journal_corrupt" });
  });
});
```

```typescript
// src/lifecycle/recovery/inspect.ts
import type { JournalEvent } from "../journal/types";
import { JOURNAL_EVENT_KINDS } from "../journal/types";
import type { LeaseRecord } from "../lease/types";
import type { LifecycleRecord } from "../types";
import type { RuntimeIdentity } from "./identity";
import type { RecoveryDecision } from "./types";
import { RECOVERY_DECISION_KINDS } from "./types";

export interface RecoveryInspectorDeps {
  readonly record: LifecycleRecord;
  readonly events: readonly JournalEvent[];
  readonly currentLease: LeaseRecord | null;
  readonly identity: RuntimeIdentity;
  readonly expectedOrigin: string | null;
  readonly now: number;
  readonly currentOwner?: string;
}

const lastSeqOf = (events: readonly JournalEvent[]): number => {
  if (events.length === 0) return 0;
  return events[events.length - 1]?.seq ?? 0;
};

const isMonotonic = (events: readonly JournalEvent[]): boolean => {
  for (let index = 1; index < events.length; index += 1) {
    const prev = events[index - 1];
    const curr = events[index];
    if (!prev || !curr) continue;
    if (curr.seq <= prev.seq) return false;
  }
  return true;
};

const block = (reason: RecoveryDecision extends { kind: "blocked" } ? RecoveryDecision["reason"] : never, detail: string, lastSeq: number): RecoveryDecision => ({
  kind: RECOVERY_DECISION_KINDS.BLOCKED,
  reason,
  detail,
  lastSeq,
});

interface BatchSummary {
  readonly batchId: string;
  readonly dispatched: boolean;
  readonly completed: boolean;
  readonly observedCommit: boolean;
}

const summarize = (events: readonly JournalEvent[]): readonly BatchSummary[] => {
  const map = new Map<string, { dispatched: boolean; completed: boolean; observedCommit: boolean }>();
  const order: string[] = [];
  for (const event of events) {
    if (event.batchId === null) continue;
    let entry = map.get(event.batchId);
    if (!entry) {
      entry = { dispatched: false, completed: false, observedCommit: false };
      map.set(event.batchId, entry);
      order.push(event.batchId);
    }
    if (event.kind === JOURNAL_EVENT_KINDS.BATCH_DISPATCHED) entry.dispatched = true;
    if (event.kind === JOURNAL_EVENT_KINDS.BATCH_COMPLETED) entry.completed = true;
    if (event.kind === JOURNAL_EVENT_KINDS.COMMIT_OBSERVED) entry.observedCommit = true;
  }
  return order.map((batchId) => {
    const entry = map.get(batchId);
    return {
      batchId,
      dispatched: entry?.dispatched ?? false,
      completed: entry?.completed ?? false,
      observedCommit: entry?.observedCommit ?? false,
    };
  });
};

export function inspectRecovery(deps: RecoveryInspectorDeps): RecoveryDecision {
  const lastSeq = lastSeqOf(deps.events);

  if (!isMonotonic(deps.events)) {
    return block("journal_corrupt", "journal sequence is not strictly increasing", lastSeq);
  }

  if (deps.identity.branch !== null && deps.identity.branch !== deps.record.branch) {
    return block("branch_mismatch", `expected ${deps.record.branch}, found ${deps.identity.branch}`, lastSeq);
  }

  if (deps.identity.worktree !== deps.record.worktree) {
    return block("worktree_mismatch", `expected ${deps.record.worktree}, found ${deps.identity.worktree}`, lastSeq);
  }

  if (deps.expectedOrigin !== null && deps.identity.origin !== null && deps.identity.origin !== deps.expectedOrigin) {
    return block("origin_mismatch", `expected ${deps.expectedOrigin}, found ${deps.identity.origin}`, lastSeq);
  }

  if (deps.currentLease !== null && deps.currentLease.owner !== (deps.currentOwner ?? deps.currentLease.owner)) {
    const expired = deps.now - deps.currentLease.heartbeatAt > deps.currentLease.ttlMs;
    if (!expired) {
      return block("lease_active", `lease held by ${deps.currentLease.owner}`, lastSeq);
    }
  }

  const summaries = summarize(deps.events);
  const reconciled: string[] = [];
  let pending: string | null = null;
  for (const summary of summaries) {
    if (summary.completed) continue;
    if (summary.observedCommit) {
      reconciled.push(summary.batchId);
      continue;
    }
    if (summary.dispatched) {
      pending = summary.batchId;
      break;
    }
  }

  if (pending !== null) {
    return {
      kind: RECOVERY_DECISION_KINDS.PARTIAL_RESUME,
      completedBatches: summaries.filter((s) => s.completed).map((s) => s.batchId),
      pendingBatchId: pending,
      note: `batch ${pending} was dispatched but never completed and has no commit_observed event`,
      lastSeq,
    };
  }

  if (reconciled.length > 0) {
    const completed = summaries.filter((s) => s.completed).map((s) => s.batchId);
    return {
      kind: RECOVERY_DECISION_KINDS.RECONCILED_RESUME,
      backfilledBatches: reconciled,
      nextBatchId: completed[completed.length - 1] ?? null,
      lastSeq,
    };
  }

  const completed = summaries.filter((s) => s.completed).map((s) => s.batchId);
  return {
    kind: RECOVERY_DECISION_KINDS.CLEAN_RESUME,
    nextBatchId: completed[completed.length - 1] ?? null,
    lastSeq,
  };
}
```

**Verify:** `bun test tests/lifecycle/recovery/inspect.test.ts`
**Commit:** `feat(lifecycle): add conservative recovery inspector`

### Task 3.2: Commit-message marker support
**File:** `src/lifecycle/commit-message.ts`
**Test:** `tests/lifecycle/commit-message.test.ts` (extend existing test file)
**Depends:** 1.5
**Domain:** backend

> Modify the existing `buildLifecycleCommitMessage` to accept an optional `marker?: string` field. When present, append a blank line and the raw marker to the message. The marker is expected to be a valid execution marker; this function does NOT validate, since markers are produced by `markers.ts`. Existing callers that do not pass a marker continue to work unchanged.

```typescript
// tests/lifecycle/commit-message.test.ts (FULL replacement; keeps existing assertions and adds two)
import { describe, expect, it } from "bun:test";

import { buildLifecycleCommitMessage } from "@/lifecycle/commit-message";

describe("buildLifecycleCommitMessage", () => {
  it("renders type, scope, summary and issue", () => {
    expect(buildLifecycleCommitMessage({ type: "feat", scope: "lifecycle", summary: "add x", issueNumber: 10 })).toBe(
      "feat(lifecycle): add x (#10)",
    );
  });

  it("rejects invalid scopes", () => {
    expect(() =>
      buildLifecycleCommitMessage({ type: "feat", scope: "BAD", summary: "x", issueNumber: 10 }),
    ).toThrow(/Invalid commit scope/);
  });

  it("rejects multi-line summary", () => {
    expect(() =>
      buildLifecycleCommitMessage({ type: "feat", scope: "x", summary: "a\nb", issueNumber: 10 }),
    ).toThrow(/single-line/);
  });

  it("rejects non-positive issue number", () => {
    expect(() =>
      buildLifecycleCommitMessage({ type: "feat", scope: "x", summary: "y", issueNumber: 0 }),
    ).toThrow(/Invalid issue number/);
  });

  it("appends a marker trailer when provided", () => {
    const marker = "<!-- micode:lc issue=10 batch=1 attempt=1 seq=3 -->";
    const message = buildLifecycleCommitMessage({
      type: "feat",
      scope: "lifecycle",
      summary: "add y",
      issueNumber: 10,
      marker,
    });
    expect(message).toBe(`feat(lifecycle): add y (#10)\n\n${marker}`);
  });

  it("ignores empty marker", () => {
    const message = buildLifecycleCommitMessage({
      type: "feat",
      scope: "lifecycle",
      summary: "add y",
      issueNumber: 10,
      marker: "",
    });
    expect(message).toBe("feat(lifecycle): add y (#10)");
  });
});
```

```typescript
// src/lifecycle/commit-message.ts (EDIT in place)
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NEWLINE_PATTERN = /[\r\n]/;
const MARKER_SEPARATOR = "\n\n";

export interface CommitMessageInput {
  readonly type: "feat" | "fix" | "chore" | "refactor" | "docs" | "test";
  readonly scope: string;
  readonly summary: string;
  readonly issueNumber: number;
  readonly marker?: string;
}

export function buildLifecycleCommitMessage(input: CommitMessageInput): string {
  if (!SCOPE_PATTERN.test(input.scope)) throw new Error(`Invalid commit scope: ${input.scope}`);
  if (NEWLINE_PATTERN.test(input.summary)) throw new Error("Commit summary must be single-line");
  if (input.issueNumber <= 0) throw new Error(`Invalid issue number: ${input.issueNumber}`);
  const headline = `${input.type}(${input.scope}): ${input.summary} (#${input.issueNumber})`;
  if (!input.marker || input.marker.length === 0) return headline;
  return `${headline}${MARKER_SEPARATOR}${input.marker}`;
}
```

**Verify:** `bun test tests/lifecycle/commit-message.test.ts`
**Commit:** `feat(lifecycle): support execution marker trailer in commit messages`

### Task 3.3: Progress comment marker support
**File:** `src/lifecycle/progress.ts`
**Test:** `tests/lifecycle/progress.test.ts` (extend existing test file with marker assertions)
**Depends:** 1.5
**Domain:** backend

> Add an optional `marker?: string` field to `ProgressInput`. When present, prepend the marker to the comment body (before the existing `<!-- micode:lifecycle:progress ... -->` line). Existing callers that do not pass a marker keep the previous body shape exactly. Update `formatBody` to splice in the marker. No public API removal.

```typescript
// tests/lifecycle/progress.test.ts (ADD new describe block; preserve existing tests verbatim)
//
// Append the following describe to the existing file. Implementer must NOT modify the existing
// describe blocks; their assertions still pass because they never pass a `marker` field.

import { describe, expect, it } from "bun:test";

import { createProgressLogger, type ProgressLoggerDeps } from "@/lifecycle/progress";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { Resolver } from "@/lifecycle/resolver";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

describe("progress logger marker", () => {
  it("prepends a marker to the comment body when provided", async () => {
    let captured = "";
    const runner: LifecycleRunner = {
      async git() { return ok(); },
      async gh(args) {
        if (args[0] === "issue" && args[1] === "comment") {
          captured = args[args.length - 1] ?? "";
          return ok("https://github.com/o/r/issues/10#issuecomment-1");
        }
        return ok();
      },
    };
    const resolver = { current: async () => ({ kind: "resolved" as const, record: { issueNumber: 10 } as any }), resume: async () => ({ issueNumber: 10 } as any) } satisfies Resolver;
    const deps: ProgressLoggerDeps = { runner, resolver, cwd: "/tmp", now: () => new Date(0) };
    const logger = createProgressLogger(deps);
    await logger.log({
      issueNumber: 10,
      kind: "status",
      summary: "batch 1 complete",
      marker: "<!-- micode:lc issue=10 batch=1 attempt=1 seq=2 -->",
    });
    expect(captured.startsWith("<!-- micode:lc issue=10 batch=1 attempt=1 seq=2 -->\n")).toBe(true);
    expect(captured.includes("<!-- micode:lifecycle:progress")).toBe(true);
  });
});
```

```typescript
// src/lifecycle/progress.ts (EDIT only the public ProgressInput and formatBody; keep all other code)
//
// 1. Add `marker?: string` to ProgressInput.
// 2. In formatBody, if marker is provided and non-empty, prepend `${marker}\n` to the returned body.
// 3. Pass `input.marker` into formatBody from `log()`.
//
// Concretely the diff is:
//
// EXISTING:
//   const formatBody = (kind: ProgressKind, summary: string, details: string | undefined, when: Date): string => {
//     ...
//     return `${PROGRESS_MARKER_PREFIX} kind=${kind} at=${isoStamp} -->\n## ${kind.toUpperCase()} - ${isoStamp}\n\n${summary}${detailsBlock}`;
//   };
//
// NEW:
   const formatBody = (
     kind: ProgressKind,
     summary: string,
     details: string | undefined,
     when: Date,
     marker: string | undefined,
   ): string => {
     const isoStamp = when.toISOString();
     const detailsBlock = details ? `\n\n<details>\n${details}\n</details>` : "";
     const head = marker && marker.length > 0 ? `${marker}\n` : "";
     return `${head}${PROGRESS_MARKER_PREFIX} kind=${kind} at=${isoStamp} -->\n## ${kind.toUpperCase()} - ${isoStamp}\n\n${summary}${detailsBlock}`;
   };
//
// EXISTING ProgressInput:
//   export interface ProgressInput {
//     readonly issueNumber?: number;
//     readonly kind: ProgressKind;
//     readonly summary: string;
//     readonly details?: string;
//   }
//
// NEW:
   export interface ProgressInput {
     readonly issueNumber?: number;
     readonly kind: ProgressKind;
     readonly summary: string;
     readonly details?: string;
     readonly marker?: string;
   }
//
// EXISTING log():
//   const body = formatBody(input.kind, input.summary, input.details, now());
//
// NEW:
   const body = formatBody(input.kind, input.summary, input.details, now(), input.marker);
```

**Verify:** `bun test tests/lifecycle/progress.test.ts`
**Commit:** `feat(lifecycle): support execution marker prefix in progress comments`

---

## Batch 4: Lifecycle handle integration and new tool (parallel - 2 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2

### Task 4.1: Lifecycle handle integration (recordExecutorEvent + decideRecovery + marker injection)
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/executor-recovery.test.ts`
**Depends:** 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
**Domain:** backend

> Modify `src/lifecycle/index.ts` to: (a) accept optional `journal: JournalStore` and `lease: LeaseStore` in `LifecycleStoreInput`, (b) thread them into `LifecycleContext`, (c) expose two new public methods on `LifecycleHandle`: `recordExecutorEvent(input)` and `decideRecovery(issueNumber, currentOwner)`, (d) inject an execution marker into commit message and progress emission whenever the caller passes one, (e) automatically append a `commit_observed` journal event when a commit succeeds with marker present. Existing handle methods `start`, `recordArtifact`, `commit`, `finish`, `load`, `setState` keep their current signatures; only `commit` gains an optional marker field.

```typescript
// tests/lifecycle/executor-recovery.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import { createLeaseStore } from "@/lifecycle/lease/store";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";

const ISSUE = 10;
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

const repoView = JSON.stringify({
  nameWithOwner: "Wuxie233/micode",
  isFork: true,
  parent: { nameWithOwner: "vtemian/micode", url: "https://github.com/vtemian/micode" },
  owner: { login: "Wuxie233" },
  viewerPermission: "ADMIN",
  hasIssuesEnabled: true,
});

const createRunner = (): LifecycleRunner => ({
  async git(args) {
    if (args[0] === "remote" && args[1] === "get-url") return ok(`${ORIGIN}\n`);
    if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return ok(`issue/${ISSUE}-feature\n`);
    if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return ok("/tmp/wt\n");
    if (args[0] === "rev-parse" && args[1] === "HEAD") return ok("abc123\n");
    return ok();
  },
  async gh(args) {
    if (args[0] === "repo" && args[1] === "view") return ok(repoView);
    if (args[0] === "issue" && args[1] === "view") return ok(JSON.stringify({ body: "" }));
    return ok();
  },
});

describe("executor recovery integration", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-exec-recovery-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("recordExecutorEvent appends to the journal with monotonic seq", async () => {
    const journal = createJournalStore({ baseDir });
    const lease = createLeaseStore({ baseDir });
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot: "/tmp",
      cwd: "/tmp/wt",
      baseDir,
      journal,
      lease,
    });
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });
    const events = await journal.list(ISSUE);
    expect(events.map((event) => event.kind)).toEqual([JOURNAL_EVENT_KINDS.BATCH_DISPATCHED]);
    expect(events[0]?.seq).toBe(1);
  });

  it("decideRecovery returns clean_resume on a fresh lifecycle", async () => {
    const journal = createJournalStore({ baseDir });
    const lease = createLeaseStore({ baseDir });
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot: "/tmp",
      cwd: "/tmp/wt",
      baseDir,
      journal,
      lease,
    });
    // Seed a lifecycle record manually via the store directory; bypass start to keep test focused.
    const recordPath = join(baseDir, `${ISSUE}.json`);
    Bun.write(recordPath, JSON.stringify({
      issueNumber: ISSUE,
      issueUrl: `https://github.com/Wuxie233/micode/issues/${ISSUE}`,
      branch: `issue/${ISSUE}-feature`,
      worktree: "/tmp/wt",
      state: LIFECYCLE_STATES.IN_PROGRESS,
      artifacts: {
        [ARTIFACT_KINDS.DESIGN]: [],
        [ARTIFACT_KINDS.PLAN]: [],
        [ARTIFACT_KINDS.LEDGER]: [],
        [ARTIFACT_KINDS.COMMIT]: [],
        [ARTIFACT_KINDS.PR]: [],
        [ARTIFACT_KINDS.WORKTREE]: [],
      },
      notes: [],
      updatedAt: 0,
    }));
    // Bun.write returns a promise; ensure it settled.
    await Bun.sleep(20);
    const decision = await handle.decideRecovery(ISSUE, "session-a");
    expect(decision.kind).toBe("clean_resume");
  });
});
```

```typescript
// src/lifecycle/index.ts (EDIT in place; only the affected pieces are listed below)
//
// 1. Add new imports near the top:
//    import { createJournalStore, type JournalStore } from "./journal/store";
//    import type { JournalEventInput } from "./journal/types";
//    import { createLeaseStore, type LeaseStore } from "./lease/store";
//    import { probeRuntimeIdentity } from "./recovery/identity";
//    import { inspectRecovery } from "./recovery/inspect";
//    import type { RecoveryDecision } from "./recovery/types";
//    import { buildExecutionMarker } from "./markers";
//
// 2. Extend LifecycleStoreInput:
//    export interface LifecycleStoreInput {
//      readonly runner: LifecycleRunner;
//      readonly worktreesRoot: string;
//      readonly cwd: string;
//      readonly baseDir?: string;
//      readonly progress?: ProgressEmitter;
//      readonly journal?: JournalStore;
//      readonly lease?: LeaseStore;
//    }
//
// 3. Extend LifecycleHandle public surface:
//    export interface LifecycleHandle {
//      readonly start: (input: StartRequestInput) => Promise<LifecycleRecord>;
//      readonly recordArtifact: (issueNumber: number, kind: ArtifactKind, pointer: string) => Promise<LifecycleRecord>;
//      readonly commit: (issueNumber: number, input: CommitInput) => Promise<CommitOutcome>;
//      readonly finish: (issueNumber: number, input: FinishInput) => Promise<FinishOutcome>;
//      readonly load: (issueNumber: number) => Promise<LifecycleRecord | null>;
//      readonly setState: (issueNumber: number, state: LifecycleState) => Promise<LifecycleRecord>;
//      readonly recordExecutorEvent: (input: ExecutorEventInput) => Promise<void>;
//      readonly decideRecovery: (issueNumber: number, currentOwner: string) => Promise<RecoveryDecision>;
//    }
//
// 4. Extend CommitInput to allow an optional marker (additive, no breakage):
//    export interface CommitInput {
//      readonly summary: string;
//      readonly scope: string;
//      readonly push: boolean;
//      readonly batchId?: string;
//      readonly taskId?: string;
//      readonly attempt?: number;
//    }
//
//    Implementer note: CommitInput is exported from ./types. Either extend the type there OR
//    accept the new optional fields only at this index.ts boundary by intersecting locally.
//    Prefer extending ./types so external callers see the new fields.
//
// 5. Add the new ExecutorEventInput type at module top:
//    export interface ExecutorEventInput {
//      readonly issueNumber: number;
//      readonly kind: JournalEventInput["kind"];
//      readonly batchId?: string | null;
//      readonly taskId?: string | null;
//      readonly attempt?: number;
//      readonly summary: string;
//      readonly reviewOutcome?: JournalEventInput["reviewOutcome"];
//    }
//
// 6. Extend LifecycleContext to carry journal and lease:
//    interface LifecycleContext {
//      readonly runner: LifecycleRunner;
//      readonly store: LifecycleStore;
//      readonly worktreesRoot: string;
//      readonly cwd: string;
//      readonly progress?: ProgressEmitter;
//      readonly journal: JournalStore;
//      readonly lease: LeaseStore;
//    }
//
// 7. Implement createCommitter so it builds an execution marker when batchId is supplied,
//    threads the marker into commitAndPush via a new optional field on CommitAndPushInput,
//    and journals a `commit_observed` event after a successful commit:
//
//    const createCommitter = (context: LifecycleContext): LifecycleHandle["commit"] => {
//      return async (issueNumber, commitInput) => {
//        const record = await requireRecord(context.store, issueNumber);
//        const seq = (await context.journal.lastSeq(issueNumber)) + 1;
//        const marker = commitInput.batchId
//          ? buildExecutionMarker({
//              issueNumber,
//              batchId: commitInput.batchId,
//              taskId: commitInput.taskId ?? null,
//              attempt: commitInput.attempt ?? 1,
//              seq,
//            })
//          : undefined;
//        const outcome = await commitAndPush(context.runner, {
//          cwd: record.worktree,
//          issueNumber,
//          branch: record.branch,
//          type: DEFAULT_COMMIT_TYPE,
//          scope: commitInput.scope,
//          summary: commitInput.summary,
//          push: commitInput.push,
//          marker,
//        });
//        await saveAndSync(context, applyCommitOutcome(record, outcome));
//        if (outcome.committed && marker) {
//          await context.journal.append(issueNumber, {
//            kind: "commit_observed",
//            batchId: commitInput.batchId ?? null,
//            taskId: commitInput.taskId ?? null,
//            attempt: commitInput.attempt ?? 1,
//            summary: outcome.sha ? `commit ${outcome.sha}` : "commit (no sha)",
//            commitMarker: marker,
//          });
//        }
//        const pushed = outcome.pushed ? "true" : "false";
//        await safeEmit(context, issueNumber, `Committed ${outcome.sha ?? "(no-op)"}, pushed=${pushed}`);
//        return outcome;
//      };
//    };
//
//    NOTE: commitAndPush already accepts a CommitMessageInput; extend src/lifecycle/commits.ts's
//    CommitAndPushInput with an optional `marker?: string` and pass it through to
//    buildLifecycleCommitMessage. This is a minor co-modification (5 lines) of commits.ts;
//    keep it inside this task to avoid a separate batch.
//
// 8. Implement createExecutorEventRecorder:
//
//    const createExecutorEventRecorder = (context: LifecycleContext): LifecycleHandle["recordExecutorEvent"] => {
//      return async (input) => {
//        await context.journal.append(input.issueNumber, {
//          kind: input.kind,
//          batchId: input.batchId ?? null,
//          taskId: input.taskId ?? null,
//          attempt: input.attempt ?? 0,
//          summary: input.summary,
//          reviewOutcome: input.reviewOutcome ?? null,
//        });
//      };
//    };
//
// 9. Implement createRecoveryDecider:
//
//    const createRecoveryDecider = (context: LifecycleContext): LifecycleHandle["decideRecovery"] => {
//      return async (issueNumber, currentOwner) => {
//        const record = await requireRecord(context.store, issueNumber);
//        const events = await context.journal.list(issueNumber);
//        const lease = await context.lease.load(issueNumber);
//        const identity = await probeRuntimeIdentity(context.runner, context.cwd);
//        const expectedOrigin = await readExpectedOrigin(context, record);
//        return inspectRecovery({
//          record,
//          events,
//          currentLease: lease,
//          identity,
//          expectedOrigin,
//          now: Date.now(),
//          currentOwner,
//        });
//      };
//    };
//
//    where readExpectedOrigin reads the lifecycle record's stored origin if present, else falls
//    back to the runtime identity (i.e. trust current). For Phase 1, return null when not stored
//    on the record. Future phases may persist this field.
//
//    const readExpectedOrigin = async (_context: LifecycleContext, _record: LifecycleRecord): Promise<string | null> => null;
//
// 10. In createLifecycleStore (the factory at the bottom of the file), default journal/lease when
//     not provided:
//
//     export function createLifecycleStore(input: LifecycleStoreInput): LifecycleHandle {
//       const baseDir = input.baseDir ?? join(input.cwd, config.lifecycle.lifecycleDir);
//       const store = createJsonLifecycleStore({ baseDir });
//       const journal = input.journal ?? createJournalStore({ baseDir });
//       const lease = input.lease ?? createLeaseStore({ baseDir });
//       const context: LifecycleContext = {
//         runner: input.runner,
//         store,
//         worktreesRoot: input.worktreesRoot,
//         cwd: input.cwd,
//         progress: input.progress,
//         journal,
//         lease,
//       };
//       return {
//         start: createStart(context),
//         recordArtifact: createArtifactRecorder(context),
//         commit: createCommitter(context),
//         finish: createFinisher(context),
//         load: store.load,
//         setState: createStateSetter(context),
//         recordExecutorEvent: createExecutorEventRecorder(context),
//         decideRecovery: createRecoveryDecider(context),
//       };
//     }
//
// 11. CommitInput type: add optional batchId, taskId, attempt fields in src/lifecycle/types.ts.
//     Update the existing CommitInput interface. This is a co-modification but keeps the public
//     surface coherent. Existing callers (current commit tool) keep working because all fields
//     are optional.
//
// 12. Update src/lifecycle/commits.ts CommitAndPushInput to add `readonly marker?: string;` and
//     forward it into buildLifecycleCommitMessage:
//
//     const message = buildLifecycleCommitMessage({ ...input, marker: input.marker });
//
//     This 2-line change happens in this same task to keep the marker-injection complete.
```

**Verify:** `bun test tests/lifecycle/executor-recovery.test.ts && bun test tests/lifecycle/index.test.ts && bun test tests/lifecycle/commits.test.ts`
**Commit:** `feat(lifecycle): integrate executor journal, lease and marker injection`

### Task 4.2: lifecycle_recovery_decision tool
**File:** `src/tools/lifecycle/recovery-decision.ts`
**Test:** `tests/tools/lifecycle/recovery-decision.test.ts`
**Depends:** 4.1
**Domain:** backend

```typescript
// tests/tools/lifecycle/recovery-decision.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";
import { RECOVERY_DECISION_KINDS, type RecoveryDecision } from "@/lifecycle/recovery/types";
import type { LifecycleHandle } from "@/lifecycle";

const fakeHandle = (decision: RecoveryDecision): Pick<LifecycleHandle, "decideRecovery"> => ({
  decideRecovery: async () => decision,
});

describe("lifecycle_recovery_decision tool", () => {
  it("formats a clean_resume decision", async () => {
    const tool = createLifecycleRecoveryDecisionTool(
      fakeHandle({ kind: RECOVERY_DECISION_KINDS.CLEAN_RESUME, nextBatchId: null, lastSeq: 0 }) as LifecycleHandle,
    );
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("clean_resume");
  });

  it("formats a blocked decision with reason", async () => {
    const tool = createLifecycleRecoveryDecisionTool(
      fakeHandle({
        kind: RECOVERY_DECISION_KINDS.BLOCKED,
        reason: "branch_mismatch",
        detail: "expected issue/10-x, found main",
        lastSeq: 3,
      }) as LifecycleHandle,
    );
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("blocked");
    expect(output).toContain("branch_mismatch");
    expect(output).toContain("expected issue/10-x");
  });

  it("returns failure header when handle throws", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => {
        throw new Error("kaboom");
      },
    } as LifecycleHandle);
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("failed");
    expect(output).toContain("kaboom");
  });
});
```

```typescript
// src/tools/lifecycle/recovery-decision.ts
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { LifecycleHandle } from "@/lifecycle";
import type { RecoveryDecision } from "@/lifecycle/recovery/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Inspect lifecycle state and produce a recovery decision.

Use after an OpenCode restart, before resuming executor work. Read-only: this tool does not mutate
state. The decision is one of clean_resume, reconciled_resume, partial_resume, or blocked.`;

const SUCCESS_HEADER = "## Lifecycle recovery decision";
const FAILURE_HEADER = "## lifecycle_recovery_decision failed";
const LINE_BREAK = "\n";

const formatDecision = (decision: RecoveryDecision): string => {
  const lines = [`**kind:** \`${decision.kind}\``, `**lastSeq:** ${decision.lastSeq}`];
  if (decision.kind === "blocked") {
    lines.push(`**reason:** \`${decision.reason}\``);
    lines.push(`**detail:** ${decision.detail}`);
  }
  if (decision.kind === "reconciled_resume") {
    lines.push(`**backfilledBatches:** ${decision.backfilledBatches.join(", ") || "(none)"}`);
    lines.push(`**nextBatchId:** ${decision.nextBatchId ?? "(none)"}`);
  }
  if (decision.kind === "partial_resume") {
    lines.push(`**completedBatches:** ${decision.completedBatches.join(", ") || "(none)"}`);
    lines.push(`**pendingBatchId:** ${decision.pendingBatchId}`);
    lines.push(`**note:** ${decision.note}`);
  }
  if (decision.kind === "clean_resume") {
    lines.push(`**nextBatchId:** ${decision.nextBatchId ?? "(none)"}`);
  }
  return [SUCCESS_HEADER, "", ...lines].join(LINE_BREAK);
};

export type RecoveryHandle = Pick<LifecycleHandle, "decideRecovery">;

export function createLifecycleRecoveryDecisionTool(handle: RecoveryHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number for the lifecycle record"),
      owner: tool.schema.string().describe("Caller identifier (typically the OpenCode session id)"),
    },
    execute: async (args) => {
      try {
        const decision = await handle.decideRecovery(args.issue_number, args.owner);
        return formatDecision(decision);
      } catch (error) {
        return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
```

**Verify:** `bun test tests/tools/lifecycle/recovery-decision.test.ts`
**Commit:** `feat(lifecycle): expose lifecycle_recovery_decision tool`

---

## Batch 5: Wiring and integration tests (parallel - 3 implementers)

All tasks in this batch depend on Batch 4 completing.
Tasks: 5.1, 5.2, 5.3

### Task 5.1: Wire recovery-decision tool into createLifecycleTools
**File:** `src/tools/lifecycle/index.ts`
**Test:** `tests/tools/lifecycle/index-wiring.test.ts`
**Depends:** 4.2
**Domain:** backend

> Modify the existing `LifecycleTools` interface and the `createLifecycleTools` factory to expose the new `lifecycle_recovery_decision` tool. The factory already takes a `LifecycleHandle`; reuse it. Do not change any other tool's wiring.

```typescript
// tests/tools/lifecycle/index-wiring.test.ts
import { describe, expect, it } from "bun:test";

import type { LifecycleHandle } from "@/lifecycle";
import type { ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleTools } from "@/tools/lifecycle";

describe("createLifecycleTools wiring", () => {
  it("exposes lifecycle_recovery_decision among the returned tools", () => {
    const handle = { decideRecovery: async () => ({ kind: "clean_resume", nextBatchId: null, lastSeq: 0 }) } as unknown as LifecycleHandle;
    const resolver = { current: async () => ({ kind: "none" as const }), resume: async () => { throw new Error("noop"); } } as unknown as Resolver;
    const progress = { log: async () => ({ issueNumber: 0, kind: "status", commentUrl: null }), context: async () => ({ issueNumber: 0, body: "", recentProgress: [] }) } as unknown as ProgressLogger;
    const tools = createLifecycleTools(handle, resolver, progress);
    expect(typeof tools.lifecycle_recovery_decision).toBe("object");
  });
});
```

```typescript
// src/tools/lifecycle/index.ts (EDIT in place)
import type { ToolDefinition } from "@opencode-ai/plugin";

import type { LifecycleHandle } from "@/lifecycle";
import type { ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleCommitTool } from "./commit";
import { createLifecycleContextTool } from "./context";
import { createLifecycleCurrentTool } from "./current";
import { createLifecycleFinishTool } from "./finish";
import { createLifecycleLogProgressTool } from "./log-progress";
import { createLifecycleRecordArtifactTool } from "./record-artifact";
import { createLifecycleRecoveryDecisionTool } from "./recovery-decision";
import { createLifecycleResumeTool } from "./resume";
import { createLifecycleStartRequestTool } from "./start-request";

export interface LifecycleTools {
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
  readonly lifecycle_current: ToolDefinition;
  readonly lifecycle_resume: ToolDefinition;
  readonly lifecycle_log_progress: ToolDefinition;
  readonly lifecycle_context: ToolDefinition;
  readonly lifecycle_recovery_decision: ToolDefinition;
}

export function createLifecycleTools(
  handle: LifecycleHandle,
  resolver: Resolver,
  progress: ProgressLogger,
): LifecycleTools {
  return {
    lifecycle_start_request: createLifecycleStartRequestTool(handle),
    lifecycle_record_artifact: createLifecycleRecordArtifactTool(handle),
    lifecycle_commit: createLifecycleCommitTool(handle),
    lifecycle_finish: createLifecycleFinishTool(handle),
    lifecycle_current: createLifecycleCurrentTool(resolver),
    lifecycle_resume: createLifecycleResumeTool(resolver),
    lifecycle_log_progress: createLifecycleLogProgressTool(progress),
    lifecycle_context: createLifecycleContextTool(progress),
    lifecycle_recovery_decision: createLifecycleRecoveryDecisionTool(handle),
  };
}
```

**Verify:** `bun test tests/tools/lifecycle/index-wiring.test.ts`
**Commit:** `feat(lifecycle): wire lifecycle_recovery_decision tool`

### Task 5.2: Wire journal and lease stores into the plugin entrypoint
**File:** `src/index.ts`
**Test:** `tests/index-wiring.test.ts` (extend existing test if relevant; otherwise smoke-import test)
**Depends:** 4.1
**Domain:** general

> Modify `src/index.ts` to construct `JournalStore` and `LeaseStore` from `src/lifecycle/journal/store.ts` and `src/lifecycle/lease/store.ts` using `join(ctx.directory, config.lifecycle.lifecycleDir)` as the baseDir, and pass them into `createLifecycleStore({ ...existing, journal, lease })`. Do not change other wiring. The change is additive.

```typescript
// tests/index-wiring.test.ts (ADD a new describe block; do not modify existing ones)
import { describe, expect, it } from "bun:test";

import { createJournalStore } from "@/lifecycle/journal/store";
import { createLeaseStore } from "@/lifecycle/lease/store";

describe("plugin entrypoint exports lifecycle journal/lease wiring", () => {
  it("createJournalStore is callable with no options", () => {
    expect(typeof createJournalStore({}).append).toBe("function");
  });
  it("createLeaseStore is callable with no options", () => {
    expect(typeof createLeaseStore({}).acquire).toBe("function");
  });
});
```

```typescript
// src/index.ts (EDIT only the lifecycle wiring block; preserve everything else)
//
// EXISTING (around lines 378-394):
//   const lifecycleResolver = createResolver({
//     runner: createLifecycleRunner(),
//     store: createLifecycleJsonStore({ baseDir: join(ctx.directory, config.lifecycle.lifecycleDir) }),
//     cwd: ctx.directory,
//   });
//   const lifecycleProgress = createProgressLogger({...});
//   const lifecycleHandle = createLifecycleStore({
//     runner: createLifecycleRunner(),
//     worktreesRoot: dirname(ctx.directory),
//     cwd: ctx.directory,
//     progress: lifecycleProgress,
//   });
//   const lifecycleTools = createLifecycleTools(lifecycleHandle, lifecycleResolver, lifecycleProgress);
//
// NEW: Add two stores and pass them into createLifecycleStore.
   import { createJournalStore } from "@/lifecycle/journal/store";
   import { createLeaseStore } from "@/lifecycle/lease/store";
//   ... (place these next to the other lifecycle imports near line 30)
//
   const lifecycleBaseDir = join(ctx.directory, config.lifecycle.lifecycleDir);
   const lifecycleJournal = createJournalStore({ baseDir: lifecycleBaseDir });
   const lifecycleLease = createLeaseStore({ baseDir: lifecycleBaseDir });
   const lifecycleResolver = createResolver({
     runner: createLifecycleRunner(),
     store: createLifecycleJsonStore({ baseDir: lifecycleBaseDir }),
     cwd: ctx.directory,
   });
   const lifecycleProgress = createProgressLogger({
     runner: createLifecycleRunner(),
     resolver: lifecycleResolver,
     cwd: ctx.directory,
   });
   const lifecycleHandle = createLifecycleStore({
     runner: createLifecycleRunner(),
     worktreesRoot: dirname(ctx.directory),
     cwd: ctx.directory,
     progress: lifecycleProgress,
     journal: lifecycleJournal,
     lease: lifecycleLease,
   });
   const lifecycleTools = createLifecycleTools(lifecycleHandle, lifecycleResolver, lifecycleProgress);
```

**Verify:** `bun test tests/index-wiring.test.ts && bun run typecheck`
**Commit:** `feat(lifecycle): construct journal and lease stores in plugin entrypoint`

### Task 5.3: End-to-end recovery integration test
**File:** `tests/lifecycle/recovery-integration.test.ts`
**Test:** self (this task is purely a test file)
**Depends:** 4.1, 4.2, 5.1, 5.2
**Domain:** general

> A scenario test that exercises the full recovery loop using fake runners. It covers: (a) restart after batch dispatch but before completion → partial_resume, (b) restart after commit succeeds with marker but no commit_observed event → reconciled_resume backfill, (c) restart with branch mismatch → blocked, (d) restart with active lease held by another owner → blocked, (e) restart with expired lease and no journal → clean_resume.

```typescript
// tests/lifecycle/recovery-integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import { createLeaseStore } from "@/lifecycle/lease/store";
import { RECOVERY_DECISION_KINDS } from "@/lifecycle/recovery/types";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";

const ISSUE = 10;
const OWNER = "session-current";
const ORIGIN = "git@github.com:Wuxie233/micode.git";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

interface RunnerFlags {
  branch?: string;
  worktree?: string;
  origin?: string;
}

const createRunner = (flags: RunnerFlags = {}): LifecycleRunner => ({
  async git(args) {
    if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return ok(`${flags.branch ?? `issue/${ISSUE}-feature`}\n`);
    if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return ok(`${flags.worktree ?? "/tmp/wt"}\n`);
    if (args[0] === "remote" && args[1] === "get-url") return ok(`${flags.origin ?? ORIGIN}\n`);
    return ok();
  },
  async gh() {
    return ok();
  },
});

const seedRecord = (baseDir: string): void => {
  const record = {
    issueNumber: ISSUE,
    issueUrl: `https://github.com/Wuxie233/micode/issues/${ISSUE}`,
    branch: `issue/${ISSUE}-feature`,
    worktree: "/tmp/wt",
    state: LIFECYCLE_STATES.IN_PROGRESS,
    artifacts: {
      [ARTIFACT_KINDS.DESIGN]: [],
      [ARTIFACT_KINDS.PLAN]: [],
      [ARTIFACT_KINDS.LEDGER]: [],
      [ARTIFACT_KINDS.COMMIT]: [],
      [ARTIFACT_KINDS.PR]: [],
      [ARTIFACT_KINDS.WORKTREE]: [],
    },
    notes: [],
    updatedAt: 0,
  };
  writeFileSync(join(baseDir, `${ISSUE}.json`), JSON.stringify(record));
};

const buildHandle = (baseDir: string, flags: RunnerFlags = {}) => {
  const journal = createJournalStore({ baseDir });
  const lease = createLeaseStore({ baseDir });
  const handle = createLifecycleStore({
    runner: createRunner(flags),
    worktreesRoot: "/tmp",
    cwd: "/tmp/wt",
    baseDir,
    journal,
    lease,
  });
  return { handle, journal, lease };
};

describe("recovery integration scenarios", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-recovery-int-"));
    seedRecord(baseDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("partial_resume when batch was dispatched but never completed and no commit observed", async () => {
    const { handle } = buildHandle(baseDir);
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });
    const decision = await handle.decideRecovery(ISSUE, OWNER);
    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.PARTIAL_RESUME);
    if (decision.kind === RECOVERY_DECISION_KINDS.PARTIAL_RESUME) {
      expect(decision.pendingBatchId).toBe("1");
    }
  });

  it("reconciled_resume when commit_observed event closes a dispatched batch", async () => {
    const { handle } = buildHandle(baseDir);
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
      batchId: "1",
      attempt: 1,
      summary: "commit deadbeef",
    });
    const decision = await handle.decideRecovery(ISSUE, OWNER);
    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.RECONCILED_RESUME);
    if (decision.kind === RECOVERY_DECISION_KINDS.RECONCILED_RESUME) {
      expect(decision.backfilledBatches).toEqual(["1"]);
    }
  });

  it("blocks on branch mismatch", async () => {
    const { handle } = buildHandle(baseDir, { branch: "main" });
    const decision = await handle.decideRecovery(ISSUE, OWNER);
    expect(decision).toMatchObject({ kind: RECOVERY_DECISION_KINDS.BLOCKED, reason: "branch_mismatch" });
  });

  it("blocks when an unexpired lease is held by another owner", async () => {
    const { handle, lease } = buildHandle(baseDir);
    await lease.acquire({
      issueNumber: ISSUE,
      owner: "intruder",
      host: "host-x",
      branch: `issue/${ISSUE}-feature`,
      worktree: "/tmp/wt",
      ttlMs: 60_000,
    });
    const decision = await handle.decideRecovery(ISSUE, OWNER);
    expect(decision).toMatchObject({ kind: RECOVERY_DECISION_KINDS.BLOCKED, reason: "lease_active" });
  });

  it("clean_resume when no journal exists and no lease is held", async () => {
    const { handle } = buildHandle(baseDir);
    const decision = await handle.decideRecovery(ISSUE, OWNER);
    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.CLEAN_RESUME);
  });
});
```

**Verify:** `bun test tests/lifecycle/recovery-integration.test.ts`
**Commit:** `test(lifecycle): add restart recovery integration scenarios`
