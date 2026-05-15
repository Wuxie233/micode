import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { LifecycleRecordSchema, parseLifecycleRecord, parseStartRequestInput } from "@/lifecycle/schemas";
import type { LifecycleRecord } from "@/lifecycle/types";
import { ARTIFACT_KINDS, LIFECYCLE_MODES, LIFECYCLE_STATES } from "@/lifecycle/types";

const SAMPLE_ISSUE = 1;
const SAMPLE_TIME = 1_777_222_400_000;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const BRANCH = "issue/1-lifecycle";
const WORKTREE = "/tmp/micode-issue-1";
const REPO_ROOT = "/root/CODE/micode";
const NOTE = "started lifecycle";
const UNKNOWN_STATE = "unknown";
const LOCAL_ISSUE = -1;
const LOCAL_ID = "local-20260516-0001";

const createRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: SAMPLE_ISSUE,
  issueUrl: ISSUE_URL,
  mode: LIFECYCLE_MODES.REMOTE,
  localId: null,
  repoRoot: REPO_ROOT,
  remoteCapable: true,
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
  notes: [NOTE],
  updatedAt: SAMPLE_TIME,
  ...overrides,
});

const expectFailure = (raw: unknown): string[] => {
  const parsed = parseLifecycleRecord(raw);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return [];
  return parsed.issues;
};

describe("lifecycle schemas", () => {
  it("round-trips a valid record", () => {
    const record = createRecord();
    const schema = v.safeParse(LifecycleRecordSchema, record);

    expect(schema.success).toBe(true);
    expect(parseLifecycleRecord(record)).toEqual({ ok: true, record });
  });

  it("normalizes legacy records without lifecycle mode fields", () => {
    const {
      mode: _mode,
      localId: _localId,
      repoRoot: _repoRoot,
      remoteCapable: _remoteCapable,
      ...legacy
    } = createRecord();

    expect(parseLifecycleRecord(legacy)).toEqual({
      ok: true,
      record: {
        ...legacy,
        mode: LIFECYCLE_MODES.REMOTE,
        localId: null,
        repoRoot: WORKTREE,
        remoteCapable: true,
      },
    });
  });

  it("preserves explicit local-only records", () => {
    const record = createRecord({
      issueNumber: LOCAL_ISSUE,
      issueUrl: "",
      mode: LIFECYCLE_MODES.LOCAL_ONLY,
      localId: LOCAL_ID,
      repoRoot: REPO_ROOT,
      remoteCapable: false,
    });

    expect(parseLifecycleRecord(record)).toEqual({ ok: true, record });
  });

  it("rejects local-only records without a local id", () => {
    const issues = expectFailure(
      createRecord({
        issueNumber: LOCAL_ISSUE,
        issueUrl: "",
        mode: LIFECYCLE_MODES.LOCAL_ONLY,
        localId: null,
        remoteCapable: false,
      }),
    );

    expect(issues.some((issue) => issue.includes("localId"))).toBe(true);
  });

  it("rejects remote-capable local-only records", () => {
    const issues = expectFailure(
      createRecord({
        issueNumber: LOCAL_ISSUE,
        issueUrl: "",
        mode: LIFECYCLE_MODES.LOCAL_ONLY,
        localId: LOCAL_ID,
        remoteCapable: true,
      }),
    );

    expect(issues.some((issue) => issue.includes("remoteCapable"))).toBe(true);
  });

  it("returns informative issues when state is missing", () => {
    const { state: _state, ...record } = createRecord();
    const issues = expectFailure(record);

    expect(issues.some((issue) => issue.includes("state"))).toBe(true);
  });

  it("fails when state is unknown", () => {
    const issues = expectFailure({ ...createRecord(), state: UNKNOWN_STATE });

    expect(issues.some((issue) => issue.includes("state"))).toBe(true);
  });

  it("accepts an empty artifacts map", () => {
    const record = { ...createRecord(), artifacts: {} };

    expect(parseLifecycleRecord(record)).toEqual({ ok: true, record });
  });
});

describe("parseStartRequestInput", () => {
  it("accepts the canonical shape", () => {
    const result = parseStartRequestInput({ summary: "x", goals: ["a"], constraints: ["b"] });
    expect(result.ok).toBe(true);
  });

  it("rejects extra fields", () => {
    const result = parseStartRequestInput({ summary: "x", goals: [], constraints: [], ownerLogin: "vtemian" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = parseStartRequestInput({ summary: "x" });
    expect(result.ok).toBe(false);
  });
});
