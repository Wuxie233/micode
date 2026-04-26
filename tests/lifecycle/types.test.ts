import { describe, expect, it } from "bun:test";
import type { LifecycleRecord } from "../../src/lifecycle/types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "../../src/lifecycle/types";

const STATES = [
  "proposed",
  "issue_open",
  "branch_ready",
  "in_design",
  "in_plan",
  "in_progress",
  "tested",
  "merging",
  "closed",
  "cleaned",
  "aborted",
] as const;

const KINDS = ["design", "plan", "ledger", "commit", "pr", "worktree"] as const;

const SAMPLE_ISSUE = 1;
const SAMPLE_TIME = 1_777_222_400_000;

describe("lifecycle types", () => {
  it("exposes proposed state", () => {
    expect(LIFECYCLE_STATES.PROPOSED).toBe("proposed");
  });

  it("exposes the full lifecycle set", () => {
    expect(Object.values(LIFECYCLE_STATES)).toEqual(STATES);
  });

  it("exposes all artifact kinds", () => {
    expect(Object.values(ARTIFACT_KINDS)).toEqual(KINDS);
  });

  it("supports LifecycleRecord as a type-only import", () => {
    const record = {
      issueNumber: SAMPLE_ISSUE,
      issueUrl: "https://github.com/Wuxie233/micode/issues/1",
      branch: "issue/1-lifecycle",
      worktree: "/tmp/micode-issue-1",
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
      updatedAt: SAMPLE_TIME,
    } satisfies LifecycleRecord;

    expect(record.state).toBe(LIFECYCLE_STATES.PROPOSED);
  });
});
