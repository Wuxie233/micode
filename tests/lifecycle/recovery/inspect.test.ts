import { describe, expect, it } from "bun:test";

import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";
import type { LeaseRecord } from "@/lifecycle/lease/types";
import { inspectRecovery, type RecoveryInspectorDeps } from "@/lifecycle/recovery/inspect";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const ISSUE = 10;
const NOW = 5_000_000;
const BRANCH = "issue/10-feature";
const WORKTREE = "/tmp/wt";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const OTHER_ORIGIN = "git@github.com:fork/repo.git";
const OTHER_WORKTREE = "/tmp/other";
const MAIN_BRANCH = "main";
const OWNER = "session-a";
const OTHER_OWNER = "session-b";
const HOST = "host-1";
const LEASE_TTL_MS = 60_000;
const RECENT_HEARTBEAT_OFFSET_MS = 1_000;
const EXPIRED_HEARTBEAT_OFFSET_MS = LEASE_TTL_MS + 1;

const baseRecord: LifecycleRecord = {
  issueNumber: ISSUE,
  issueUrl: "https://github.com/Wuxie233/micode/issues/10",
  branch: BRANCH,
  worktree: WORKTREE,
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
  owner: OWNER,
  host: HOST,
  branch: BRANCH,
  worktree: WORKTREE,
  acquiredAt: NOW - RECENT_HEARTBEAT_OFFSET_MS,
  heartbeatAt: NOW - RECENT_HEARTBEAT_OFFSET_MS,
  ttlMs: LEASE_TTL_MS,
  ...overrides,
});

const makeDeps = (overrides: Partial<RecoveryInspectorDeps> = {}): RecoveryInspectorDeps => ({
  record: baseRecord,
  events: [],
  currentLease: null,
  identity: { branch: BRANCH, origin: ORIGIN, worktree: WORKTREE },
  expectedOrigin: ORIGIN,
  now: NOW,
  ...overrides,
});

describe("inspectRecovery", () => {
  it("returns clean_resume when there are no events and identity matches", () => {
    const decision = inspectRecovery(makeDeps());
    expect(decision.kind).toBe("clean_resume");
  });

  it("blocks on branch mismatch", () => {
    const decision = inspectRecovery(
      makeDeps({ identity: { branch: MAIN_BRANCH, origin: ORIGIN, worktree: WORKTREE } }),
    );
    expect(decision).toMatchObject({ kind: "blocked", reason: "branch_mismatch" });
  });

  it("blocks on worktree mismatch", () => {
    const decision = inspectRecovery(
      makeDeps({ identity: { branch: BRANCH, origin: ORIGIN, worktree: OTHER_WORKTREE } }),
    );
    expect(decision).toMatchObject({ kind: "blocked", reason: "worktree_mismatch" });
  });

  it("blocks on origin mismatch when expected origin is provided", () => {
    const decision = inspectRecovery(
      makeDeps({ identity: { branch: BRANCH, origin: OTHER_ORIGIN, worktree: WORKTREE } }),
    );
    expect(decision).toMatchObject({ kind: "blocked", reason: "origin_mismatch" });
  });

  it("blocks when an unexpired lease is held by another owner", () => {
    const held = lease({ owner: OTHER_OWNER, heartbeatAt: NOW - RECENT_HEARTBEAT_OFFSET_MS });
    const decision = inspectRecovery(makeDeps({ currentLease: held }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "lease_active" });
  });

  it("treats expired lease as resumable", () => {
    const stale = lease({ owner: OTHER_OWNER, heartbeatAt: NOW - EXPIRED_HEARTBEAT_OFFSET_MS });
    const decision = inspectRecovery(makeDeps({ currentLease: stale }));
    expect(decision.kind).toBe("clean_resume");
  });

  it("returns reconciled_resume when batch_dispatched has no matching completed and commit_observed closes it", () => {
    const events = [event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 1), event(JOURNAL_EVENT_KINDS.COMMIT_OBSERVED, 2)];
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
    const events = [event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 2), event(JOURNAL_EVENT_KINDS.BATCH_DISPATCHED, 1)];
    const decision = inspectRecovery(makeDeps({ events }));
    expect(decision).toMatchObject({ kind: "blocked", reason: "journal_corrupt" });
  });
});
