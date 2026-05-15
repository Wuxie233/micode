import { describe, expect, it } from "bun:test";
import type { LifecycleRecord } from "../../src/lifecycle/types";
import {
  ARTIFACT_KINDS,
  formatLifecycleIdentity,
  isLocalIssueNumber,
  isLocalOnlyLifecycleRecord,
  isRemoteLifecycleRecord,
  LIFECYCLE_MODES,
  LIFECYCLE_STATES,
} from "../../src/lifecycle/types";

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
const SAMPLE_LOCAL_ISSUE = -1;
const SAMPLE_TIME = 1_777_222_400_000;

const createLifecycleRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: SAMPLE_ISSUE,
  issueUrl: "https://github.com/Wuxie233/micode/issues/1",
  mode: LIFECYCLE_MODES.REMOTE,
  localId: null,
  repoRoot: "/root/CODE/micode",
  remoteCapable: true,
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
  ...overrides,
});

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

  it("exposes lifecycle modes", () => {
    expect(LIFECYCLE_MODES.REMOTE).toBe("remote");
    expect(LIFECYCLE_MODES.LOCAL_ONLY).toBe("local-only");
  });

  it("supports LifecycleRecord as a type-only import", () => {
    const record = createLifecycleRecord() satisfies LifecycleRecord;

    expect(record.state).toBe(LIFECYCLE_STATES.PROPOSED);
  });

  it("detects remote and local-only lifecycle records by mode", () => {
    const remoteRecord = createLifecycleRecord();
    const localOnlyRecord = createLifecycleRecord({
      issueNumber: SAMPLE_LOCAL_ISSUE,
      issueUrl: "",
      mode: LIFECYCLE_MODES.LOCAL_ONLY,
      localId: "local-20260516-0001",
      remoteCapable: false,
    });

    expect(isRemoteLifecycleRecord(remoteRecord)).toBe(true);
    expect(isLocalOnlyLifecycleRecord(remoteRecord)).toBe(false);
    expect(isRemoteLifecycleRecord(localOnlyRecord)).toBe(false);
    expect(isLocalOnlyLifecycleRecord(localOnlyRecord)).toBe(true);
  });

  it("treats only safe negative integers as local issue numbers", () => {
    expect(isLocalIssueNumber(-1)).toBe(true);
    expect(isLocalIssueNumber(-42)).toBe(true);
    expect(isLocalIssueNumber(1)).toBe(false);
    expect(isLocalIssueNumber(0)).toBe(false);
    expect(isLocalIssueNumber(-1.5)).toBe(false);
    expect(isLocalIssueNumber(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isLocalIssueNumber(Number.MIN_SAFE_INTEGER - 1)).toBe(false);
  });

  it("formats remote issue numbers and local-only identities", () => {
    const remoteRecord = createLifecycleRecord({ issueNumber: 81 });
    const localOnlyRecord = createLifecycleRecord({
      issueNumber: SAMPLE_LOCAL_ISSUE,
      issueUrl: "",
      mode: LIFECYCLE_MODES.LOCAL_ONLY,
      localId: "local-20260516-0001",
      remoteCapable: false,
    });

    expect(formatLifecycleIdentity(remoteRecord)).toBe("#81");
    expect(formatLifecycleIdentity(localOnlyRecord)).toBe("local-20260516-0001");
  });
});
