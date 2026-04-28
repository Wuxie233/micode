import { describe, expect, it } from "bun:test";

import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";

describe("journal event types", () => {
  it("exposes the documented event kinds", () => {
    expect(Object.values(JOURNAL_EVENT_KINDS).sort()).toEqual([
      "batch_completed",
      "batch_dispatched",
      "commit_observed",
      "lease_acquired",
      "lease_released",
      "recovery_blocked",
      "recovery_inspected",
      "review_completed",
    ]);
  });

  it("each event kind narrows the JournalEvent union", () => {
    const event: JournalEvent = {
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      issueNumber: 10,
      seq: 1,
      at: 1_777_000_000_000,
      batchId: "1",
      taskId: null,
      attempt: 1,
      summary: "dispatched batch 1",
      commitMarker: null,
      reviewOutcome: null,
    };
    expect(event.kind).toBe("batch_dispatched");
  });
});
