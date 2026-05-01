import { describe, expect, it } from "bun:test";
import { BLOCKED_MARKERS, TASK_ERROR_MARKERS } from "@/tools/spawn-agent/classify-tokens";
import { classifyMarker, MARKER_CONFIDENCE } from "@/tools/spawn-agent/marker-confidence";

describe("classifyMarker", () => {
  it("returns absent when no marker is present", () => {
    expect(classifyMarker("everything went well", TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.ABSENT,
      marker: null,
    });
  });

  it("treats marker on its own line as final", () => {
    expect(classifyMarker("Result:\nTEST FAILED\n", TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "TEST FAILED",
    });
  });

  it("treats marker followed by a colon as final", () => {
    expect(classifyMarker("TEST FAILED: unit test rejected the change", TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "TEST FAILED",
    });
  });

  it("treats whole-output marker as final", () => {
    expect(classifyMarker("BLOCKED:", BLOCKED_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "BLOCKED:",
    });
  });

  it("treats marker quoted mid-sentence as narrative", () => {
    expect(classifyMarker("The reviewer would print 'TEST FAILED' if anything broke.", TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.NARRATIVE,
      marker: "TEST FAILED",
    });
  });

  it("treats marker inside fenced code as narrative", () => {
    const text = "Example output:\n```\nTEST FAILED\n```\nBut the suite passed.";
    expect(classifyMarker(text, TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.NARRATIVE,
      marker: "TEST FAILED",
    });
  });

  it("ignores leading whitespace when anchoring", () => {
    expect(classifyMarker("    BLOCKED:", BLOCKED_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "BLOCKED:",
    });
  });

  it("returns the first matching marker when multiple appear on lines", () => {
    const text = "TEST FAILED\nBUILD FAILED\n";
    expect(classifyMarker(text, TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "TEST FAILED",
    });
  });

  it("prefers a later anchored marker over earlier narrative markers", () => {
    const text = [
      "Example output:",
      "```",
      "TEST FAILED",
      "```",
      "The reviewer would print 'TEST FAILED' if anything broke.",
      "BUILD FAILED: typecheck rejected the change",
    ].join("\n");

    expect(classifyMarker(text, TASK_ERROR_MARKERS)).toEqual({
      confidence: MARKER_CONFIDENCE.FINAL,
      marker: "BUILD FAILED",
    });
  });
});
