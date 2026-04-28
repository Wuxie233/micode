import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";

const ISSUE = 10;

describe("journal store", () => {
  let baseDir: string;
  let warning: ReturnType<typeof spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-journal-"));
    warning = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warning.mockRestore();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns empty list when no journal exists", async () => {
    const store = createJournalStore({ baseDir });
    await expect(store.list(ISSUE)).resolves.toEqual([]);
    await expect(store.lastSeq(ISSUE)).resolves.toBe(0);
  });

  it("appends events with monotonic seq", async () => {
    const store = createJournalStore({ baseDir });
    const first = await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      summary: "batch 1",
      batchId: "1",
      attempt: 1,
    });
    const second = await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
      summary: "batch 1 done",
      batchId: "1",
      attempt: 1,
    });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    const events = await store.list(ISSUE);
    expect(events.map((event) => event.kind)).toEqual([
      JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
    ]);
    await expect(store.lastSeq(ISSUE)).resolves.toBe(2);
  });

  it("skips malformed and invalid lines and warns", async () => {
    const store = createJournalStore({ baseDir });
    await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      summary: "ok",
      batchId: "1",
      attempt: 1,
    });
    writeFileSync(join(baseDir, `${ISSUE}.journal.jsonl`), `${"{not json"}\n`, { flag: "a" });
    writeFileSync(join(baseDir, `${ISSUE}.journal.jsonl`), `${JSON.stringify({ kind: "unknown" })}\n`, { flag: "a" });
    await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
      summary: "ok2",
      batchId: "1",
      attempt: 1,
    });
    const events = await store.list(ISSUE);
    expect(events).toHaveLength(2);
    expect(warning).toHaveBeenCalled();
  });

  it("derives appended seq from last valid event seq", async () => {
    const store = createJournalStore({ baseDir });
    writeFileSync(
      join(baseDir, `${ISSUE}.journal.jsonl`),
      `${JSON.stringify({
        kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
        issueNumber: ISSUE,
        seq: 20,
        at: 1_777_000_000_000,
        batchId: "1",
        taskId: null,
        attempt: 1,
        summary: "legacy seq",
        commitMarker: null,
        reviewOutcome: null,
      })}\n`,
    );

    const event = await store.append(ISSUE, {
      kind: JOURNAL_EVENT_KINDS.BATCH_COMPLETED,
      summary: "last seq based",
      batchId: "1",
      attempt: 1,
    });

    expect(event.seq).toBe(21);
  });

  it("rejects invalid issue numbers", async () => {
    const store = createJournalStore({ baseDir });
    await expect(
      store.append(0, {
        kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
        summary: "x",
        batchId: null,
        attempt: 0,
      }),
    ).rejects.toThrow(/Invalid issue/);
  });
});
