import { describe, expect, it } from "bun:test";

import { appendNote, isValidTransition, recordArtifact, transitionTo } from "../../src/lifecycle/transitions";
import type { LifecycleRecord, LifecycleState } from "../../src/lifecycle/types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "../../src/lifecycle/types";

const SAMPLE_ISSUE = 1;
const INITIAL_TIME = 1_777_222_400_000;
const NEXT_TIME = 1_777_222_400_999;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const BRANCH = "issue/1-lifecycle";
const WORKTREE = "/tmp/micode-issue-1";
const PLAN_POINTER = "thoughts/shared/plans/issue.md";
const DESIGN_POINTER = "thoughts/shared/designs/issue.md";
const NOTE = "recorded plan";
const INVALID_TRANSITION = "Invalid lifecycle transition: proposed -> branch_ready";

const VALID_TRANSITIONS = [
  [LIFECYCLE_STATES.PROPOSED, LIFECYCLE_STATES.ISSUE_OPEN],
  [LIFECYCLE_STATES.ISSUE_OPEN, LIFECYCLE_STATES.BRANCH_READY],
  [LIFECYCLE_STATES.BRANCH_READY, LIFECYCLE_STATES.IN_DESIGN],
  [LIFECYCLE_STATES.IN_DESIGN, LIFECYCLE_STATES.IN_PLAN],
  [LIFECYCLE_STATES.IN_PLAN, LIFECYCLE_STATES.IN_PROGRESS],
  [LIFECYCLE_STATES.IN_PROGRESS, LIFECYCLE_STATES.TESTED],
  [LIFECYCLE_STATES.TESTED, LIFECYCLE_STATES.MERGING],
  [LIFECYCLE_STATES.MERGING, LIFECYCLE_STATES.CLOSED],
  [LIFECYCLE_STATES.CLOSED, LIFECYCLE_STATES.CLEANED],
] satisfies readonly (readonly [LifecycleState, LifecycleState])[];

const STATES = Object.values(LIFECYCLE_STATES);

const createRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: SAMPLE_ISSUE,
  issueUrl: ISSUE_URL,
  branch: BRANCH,
  worktree: WORKTREE,
  state: LIFECYCLE_STATES.PROPOSED,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: INITIAL_TIME,
  ...overrides,
});

const withNow = <Value>(time: number, run: () => Value): Value => {
  const original = Date.now;
  Date.now = () => time;
  try {
    return run();
  } finally {
    Date.now = original;
  }
};

describe("lifecycle transitions", () => {
  it("accepts all valid state transitions and idempotent re-entry", () => {
    for (const [current, next] of VALID_TRANSITIONS) {
      expect(isValidTransition(current, next)).toBe(true);
    }

    for (const state of STATES) {
      expect(isValidTransition(state, state)).toBe(true);
    }
  });

  it("rejects skipped, reversed, and terminal successors", () => {
    expect(isValidTransition(LIFECYCLE_STATES.PROPOSED, LIFECYCLE_STATES.BRANCH_READY)).toBe(false);
    expect(isValidTransition(LIFECYCLE_STATES.IN_PROGRESS, LIFECYCLE_STATES.IN_PLAN)).toBe(false);
    expect(isValidTransition(LIFECYCLE_STATES.CLEANED, LIFECYCLE_STATES.ABORTED)).toBe(false);
    expect(isValidTransition(LIFECYCLE_STATES.ABORTED, LIFECYCLE_STATES.PROPOSED)).toBe(false);
  });

  it("transitions to a valid state with a fresh timestamp", () => {
    const record = createRecord();
    const transitioned = withNow(NEXT_TIME, () => transitionTo(record, LIFECYCLE_STATES.ISSUE_OPEN));

    expect(transitioned).not.toBe(record);
    expect(transitioned.state).toBe(LIFECYCLE_STATES.ISSUE_OPEN);
    expect(transitioned.updatedAt).toBe(NEXT_TIME);
    expect(record.state).toBe(LIFECYCLE_STATES.PROPOSED);
    expect(record.updatedAt).toBe(INITIAL_TIME);
  });

  it("throws before applying invalid transitions", () => {
    const record = createRecord();

    expect(() => transitionTo(record, LIFECYCLE_STATES.BRANCH_READY)).toThrow(INVALID_TRANSITION);
    expect(record.state).toBe(LIFECYCLE_STATES.PROPOSED);
  });

  it("deduplicates artifact pointers within one kind", () => {
    const record = createRecord();
    const first = recordArtifact(record, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    const second = recordArtifact(first, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    const third = recordArtifact(second, ARTIFACT_KINDS.DESIGN, DESIGN_POINTER);

    expect(second.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
    expect(third.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([PLAN_POINTER]);
    expect(third.artifacts[ARTIFACT_KINDS.DESIGN]).toEqual([DESIGN_POINTER]);
    expect(record.artifacts[ARTIFACT_KINDS.PLAN]).toEqual([]);
  });

  it("appends notes without mutating the original record", () => {
    const record = createRecord();
    const updated = appendNote(record, NOTE);

    expect(updated).not.toBe(record);
    expect(updated.notes).toEqual([NOTE]);
    expect(record.notes).toEqual([]);
  });
});
