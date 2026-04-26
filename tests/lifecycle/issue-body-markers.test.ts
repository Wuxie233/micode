import { describe, expect, it } from "bun:test";

import { extractBetween, ISSUE_BODY_MARKERS, replaceBetween } from "../../src/lifecycle/issue-body-markers";

const ORIGINAL_BODY = "Intro\n\nOutro";
const STATE_CONTENT = "state: in_progress";
const UPDATED_STATE_CONTENT = "state: tested";
const ARTIFACT_CONTENT = "- plan.md";

describe("issue body markers", () => {
  it("exposes lifecycle marker constants", () => {
    expect(ISSUE_BODY_MARKERS.STATE_BEGIN).toBe("<!-- micode:lifecycle:state:begin -->");
    expect(ISSUE_BODY_MARKERS.STATE_END).toBe("<!-- micode:lifecycle:state:end -->");
    expect(ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN).toBe("<!-- micode:lifecycle:artifacts:begin -->");
    expect(ISSUE_BODY_MARKERS.ARTIFACTS_END).toBe("<!-- micode:lifecycle:artifacts:end -->");
    expect(ISSUE_BODY_MARKERS.CHECKLIST_BEGIN).toBe("<!-- micode:lifecycle:checklist:begin -->");
    expect(ISSUE_BODY_MARKERS.CHECKLIST_END).toBe("<!-- micode:lifecycle:checklist:end -->");
  });

  it("returns null when markers are absent", () => {
    const content = extractBetween(ORIGINAL_BODY, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END);

    expect(content).toBeNull();
  });

  it("trims inner marker content", () => {
    const body = `${ISSUE_BODY_MARKERS.STATE_BEGIN}\n\n  ${STATE_CONTENT}  \n\n${ISSUE_BODY_MARKERS.STATE_END}`;

    const content = extractBetween(body, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END);

    expect(content).toBe(STATE_CONTENT);
  });

  it("replaces existing marker blocks idempotently", () => {
    const body = replaceBetween(
      ORIGINAL_BODY,
      ISSUE_BODY_MARKERS.STATE_BEGIN,
      ISSUE_BODY_MARKERS.STATE_END,
      STATE_CONTENT,
    );

    const replaced = replaceBetween(
      body,
      ISSUE_BODY_MARKERS.STATE_BEGIN,
      ISSUE_BODY_MARKERS.STATE_END,
      UPDATED_STATE_CONTENT,
    );
    const repeated = replaceBetween(
      replaced,
      ISSUE_BODY_MARKERS.STATE_BEGIN,
      ISSUE_BODY_MARKERS.STATE_END,
      UPDATED_STATE_CONTENT,
    );

    expect(repeated).toBe(replaced);
    expect(extractBetween(repeated, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END)).toBe(
      UPDATED_STATE_CONTENT,
    );
  });

  it("appends marker block when absent", () => {
    const body = replaceBetween(
      ORIGINAL_BODY,
      ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN,
      ISSUE_BODY_MARKERS.ARTIFACTS_END,
      ARTIFACT_CONTENT,
    );

    expect(body).toBe(
      `${ORIGINAL_BODY}\n\n${ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN}\n${ARTIFACT_CONTENT}\n${ISSUE_BODY_MARKERS.ARTIFACTS_END}\n`,
    );
  });
});
