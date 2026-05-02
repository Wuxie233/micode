import { describe, expect, it } from "bun:test";

import { extractBetween, ISSUE_BODY_MARKERS, replaceBetween } from "../../src/lifecycle/issue-body-markers";

const ORIGINAL_BODY = "Intro\n\nOutro";
const STATE_CONTENT = "state: in_progress";
const UPDATED_STATE_CONTENT = "state: tested";
const ARTIFACT_CONTENT = "- plan.md";
const AI_REVIEW_TITLE = "## AI Review Summary";
const AI_REVIEW_CONTENT = `${AI_REVIEW_TITLE}\n\n${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\n- initial review`;
const UPDATED_AI_REVIEW_CONTENT = `${AI_REVIEW_TITLE}\n\n${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\n- updated review`;
const EXPECTED_SINGLE_OCCURRENCE = 1;

const countOccurrences = (body: string, content: string): number => body.split(content).length - 1;

describe("issue body markers", () => {
  it("exposes lifecycle marker constants", () => {
    expect(ISSUE_BODY_MARKERS.STATE_BEGIN).toBe("<!-- micode:lifecycle:state:begin -->");
    expect(ISSUE_BODY_MARKERS.STATE_END).toBe("<!-- micode:lifecycle:state:end -->");
    expect(ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN).toBe("<!-- micode:lifecycle:artifacts:begin -->");
    expect(ISSUE_BODY_MARKERS.ARTIFACTS_END).toBe("<!-- micode:lifecycle:artifacts:end -->");
    expect(ISSUE_BODY_MARKERS.CHECKLIST_BEGIN).toBe("<!-- micode:lifecycle:checklist:begin -->");
    expect(ISSUE_BODY_MARKERS.CHECKLIST_END).toBe("<!-- micode:lifecycle:checklist:end -->");
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN).toBe("<!-- micode:lifecycle:ai-review:begin -->");
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_END).toBe("<!-- micode:lifecycle:ai-review:end -->");
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT).toBe("<!-- micode:lifecycle:ai-review-comment -->");
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

  it("inserts ai review marker blocks when absent", () => {
    const body = replaceBetween(
      ORIGINAL_BODY,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      AI_REVIEW_CONTENT,
    );

    expect(body).toBe(
      `${ORIGINAL_BODY}\n\n${ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN}\n${AI_REVIEW_CONTENT}\n${ISSUE_BODY_MARKERS.AI_REVIEW_END}\n`,
    );
  });

  it("updates ai review marker blocks idempotently without duplicating the summary title", () => {
    const body = replaceBetween(
      ORIGINAL_BODY,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      AI_REVIEW_CONTENT,
    );
    const updated = replaceBetween(
      body,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      UPDATED_AI_REVIEW_CONTENT,
    );
    const repeated = replaceBetween(
      updated,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      UPDATED_AI_REVIEW_CONTENT,
    );

    expect(repeated).toBe(updated);
    expect(countOccurrences(repeated, AI_REVIEW_TITLE)).toBe(EXPECTED_SINGLE_OCCURRENCE);
  });

  it("extracts ai review marker content", () => {
    const body = replaceBetween(
      ORIGINAL_BODY,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      AI_REVIEW_CONTENT,
    );

    expect(extractBetween(body, ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN, ISSUE_BODY_MARKERS.AI_REVIEW_END)).toBe(
      AI_REVIEW_CONTENT,
    );
  });
});
