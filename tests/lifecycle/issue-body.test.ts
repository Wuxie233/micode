import { describe, expect, it } from "bun:test";
import { parseIssueBody, renderIssueBody } from "../../src/lifecycle/issue-body";
import { extractBetween, ISSUE_BODY_MARKERS } from "../../src/lifecycle/issue-body-markers";
import type { ArtifactKind, LifecycleRecord } from "../../src/lifecycle/types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "../../src/lifecycle/types";

const SAMPLE_ISSUE = 1;
const SAMPLE_TIME = 1_777_222_400_000;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const BRANCH = "issue/1-lifecycle";
const WORKTREE = "/tmp/micode-issue-1";
const ORIGINAL_BODY = "## Context\n\nKeep this user-written paragraph.";
const PLAN_POINTER = "thoughts/shared/plans/issue-plan.md";
const DESIGN_POINTER = "thoughts/shared/designs/issue-design.md";
const COMMIT_POINTER = "abc1234";
const UNKNOWN_KIND = "note";

const createArtifacts = (
  overrides: Partial<Record<ArtifactKind, readonly string[]>> = {},
): Record<ArtifactKind, readonly string[]> => ({
  [ARTIFACT_KINDS.DESIGN]: [],
  [ARTIFACT_KINDS.PLAN]: [],
  [ARTIFACT_KINDS.LEDGER]: [],
  [ARTIFACT_KINDS.COMMIT]: [],
  [ARTIFACT_KINDS.PR]: [],
  [ARTIFACT_KINDS.WORKTREE]: [],
  ...overrides,
});

const createRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: SAMPLE_ISSUE,
  issueUrl: ISSUE_URL,
  branch: BRANCH,
  worktree: WORKTREE,
  state: LIFECYCLE_STATES.PROPOSED,
  artifacts: createArtifacts(),
  notes: [],
  updatedAt: SAMPLE_TIME,
  ...overrides,
});

describe("issue body renderer", () => {
  it("round-trips lifecycle state and artifacts", () => {
    const record = createRecord({
      state: LIFECYCLE_STATES.IN_PROGRESS,
      artifacts: createArtifacts({
        [ARTIFACT_KINDS.PLAN]: [PLAN_POINTER],
        [ARTIFACT_KINDS.COMMIT]: [COMMIT_POINTER],
      }),
    });

    const rendered = renderIssueBody(record, ORIGINAL_BODY);
    const parsed = parseIssueBody(rendered);

    expect(rendered).toContain(ORIGINAL_BODY);
    expect(parsed).toEqual({ state: record.state, artifacts: record.artifacts });
  });

  it("appends managed blocks when absent", () => {
    const rendered = renderIssueBody(createRecord(), ORIGINAL_BODY);

    expect(rendered).toContain(ISSUE_BODY_MARKERS.STATE_BEGIN);
    expect(rendered).toContain(ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN);
    expect(rendered).toContain(ISSUE_BODY_MARKERS.CHECKLIST_BEGIN);
    expect(rendered.indexOf(ORIGINAL_BODY)).toBeLessThan(rendered.indexOf(ISSUE_BODY_MARKERS.STATE_BEGIN));
  });

  it("re-renders idempotently while preserving user content", () => {
    const initial = createRecord({ state: LIFECYCLE_STATES.IN_PLAN });
    const updated = createRecord({
      state: LIFECYCLE_STATES.TESTED,
      artifacts: createArtifacts({ [ARTIFACT_KINDS.DESIGN]: [DESIGN_POINTER] }),
    });

    const rendered = renderIssueBody(initial, ORIGINAL_BODY);
    const rerendered = renderIssueBody(updated, rendered);
    const repeated = renderIssueBody(updated, rerendered);

    expect(repeated).toBe(rerendered);
    expect(rerendered).toContain(ORIGINAL_BODY);
    expect(extractBetween(rerendered, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END)).toBe(
      `state: ${LIFECYCLE_STATES.TESTED}`,
    );
    expect(parseIssueBody(rerendered)).toEqual({ state: updated.state, artifacts: updated.artifacts });
  });

  it("parses state and artifacts from edited managed blocks", () => {
    const body = [
      ISSUE_BODY_MARKERS.STATE_BEGIN,
      `  state: ${LIFECYCLE_STATES.TESTED}  `,
      ISSUE_BODY_MARKERS.STATE_END,
      ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN,
      "| Kind | Pointer |",
      "| --- | --- |",
      `| ${ARTIFACT_KINDS.PLAN} | ${PLAN_POINTER} |`,
      `| ${ARTIFACT_KINDS.DESIGN} | ${DESIGN_POINTER} |`,
      `| ${UNKNOWN_KIND} | ignored.md |`,
      "freeform user edit",
      ISSUE_BODY_MARKERS.ARTIFACTS_END,
    ].join("\n");

    expect(parseIssueBody(body)).toEqual({
      state: LIFECYCLE_STATES.TESTED,
      artifacts: createArtifacts({
        [ARTIFACT_KINDS.DESIGN]: [DESIGN_POINTER],
        [ARTIFACT_KINDS.PLAN]: [PLAN_POINTER],
      }),
    });
  });

  it("returns an empty partial when markers are absent", () => {
    expect(parseIssueBody(ORIGINAL_BODY)).toEqual({});
  });

  it("renders a checklist block", () => {
    const rendered = renderIssueBody(createRecord({ state: LIFECYCLE_STATES.CLOSED }), null);
    const checklist = extractBetween(rendered, ISSUE_BODY_MARKERS.CHECKLIST_BEGIN, ISSUE_BODY_MARKERS.CHECKLIST_END);

    expect(checklist).toContain(`- [x] ${LIFECYCLE_STATES.CLOSED}`);
  });
});
