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

  it("rejects when issueNumber is invalid", () => {
    expect(parseExecutionMarker("<!-- micode:lc issue=abc batch=1 attempt=1 seq=1 -->")).toBeNull();
    expect(parseExecutionMarker("<!-- micode:lc issue=0 batch=1 attempt=1 seq=1 -->")).toBeNull();
  });
});
