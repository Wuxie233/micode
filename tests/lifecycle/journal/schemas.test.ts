import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { JournalEventSchema, parseJournalEvent } from "@/lifecycle/journal/schemas";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";

const baseEvent = {
  kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
  issueNumber: 10,
  seq: 1,
  at: 1_777_000_000_000,
  batchId: "1",
  taskId: null,
  attempt: 1,
  summary: "dispatched",
  commitMarker: null,
  reviewOutcome: null,
};

describe("journal schemas", () => {
  it("accepts a valid event", () => {
    expect(v.safeParse(JournalEventSchema, baseEvent).success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    const result = parseJournalEvent({ ...baseEvent, kind: "made_up" });
    expect(result.ok).toBe(false);
  });

  it("rejects negative seq", () => {
    const result = parseJournalEvent({ ...baseEvent, seq: -1 });
    expect(result.ok).toBe(false);
  });

  it("returns informative issues", () => {
    const result = parseJournalEvent({ ...baseEvent, issueNumber: "ten" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((m) => m.includes("issueNumber"))).toBe(true);
  });
});
