import { describe, expect, it } from "bun:test";

import { detectBlockedTasks } from "@/lifecycle/finish-guards";
import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";

const review = (taskId: string, outcome: JournalEvent["reviewOutcome"], seq: number): JournalEvent => ({
  kind: JOURNAL_EVENT_KINDS.REVIEW_COMPLETED,
  issueNumber: 21,
  seq,
  at: seq,
  batchId: "b",
  taskId,
  attempt: 1,
  summary: "r",
  commitMarker: null,
  reviewOutcome: outcome,
});

describe("detectBlockedTasks", () => {
  it("returns empty when there are no review events", () => {
    expect(detectBlockedTasks([])).toEqual([]);
  });

  it("returns empty when every task's last review is approved", () => {
    expect(detectBlockedTasks([review("1.1", "approved", 1), review("1.2", "approved", 2)])).toEqual([]);
  });

  it("returns blocked task ids sorted", () => {
    const events = [review("1.1", "blocked", 1), review("1.2", "approved", 2), review("1.3", "blocked", 3)];
    expect(detectBlockedTasks(events)).toEqual(["1.1", "1.3"]);
  });

  it("uses only the latest review per task (so a fixed task does not register as blocked)", () => {
    const events = [review("1.1", "blocked", 1), review("1.1", "approved", 2)];
    expect(detectBlockedTasks(events)).toEqual([]);
  });

  it("ignores non-review events", () => {
    const events: JournalEvent[] = [
      review("1.1", "approved", 1),
      {
        kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
        issueNumber: 21,
        seq: 2,
        at: 2,
        batchId: "b",
        taskId: null,
        attempt: 1,
        summary: "commit",
        commitMarker: null,
        reviewOutcome: null,
      },
    ];
    expect(detectBlockedTasks(events)).toEqual([]);
  });

  it("ignores review events with null taskId", () => {
    const events = [{ ...review("1.1", "blocked", 1), taskId: null }];
    expect(detectBlockedTasks(events)).toEqual([]);
  });
});
