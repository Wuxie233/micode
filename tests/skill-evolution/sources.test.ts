import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "@/skill-evolution/sources";

describe("skill-evolution sources", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-sources-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readJournalEvents returns parsed events from a journal file", async () => {
    const lifecycleDir = join(baseDir, "thoughts", "lifecycle");
    mkdirSync(lifecycleDir, { recursive: true });
    const event = {
      kind: "review_completed",
      issueNumber: 24,
      seq: 1,
      at: 1_700_000_000_000,
      batchId: "b1",
      taskId: "t1",
      attempt: 1,
      summary: "review done",
      commitMarker: null,
      reviewOutcome: "approved",
    };
    writeFileSync(join(lifecycleDir, "24.journal.jsonl"), `${JSON.stringify(event)}\n`);

    const events = await readJournalEvents({ cwd: baseDir, issueNumber: 24 });
    expect(events.length).toBe(1);
    expect(events[0].summary).toBe("review done");
  });

  it("readJournalEvents returns empty array when journal missing", async () => {
    const events = await readJournalEvents({ cwd: baseDir, issueNumber: 999 });
    expect(events).toEqual([]);
  });

  it("readLifecycleRecord returns the markdown body when present", async () => {
    const lifecycleDir = join(baseDir, "thoughts", "lifecycle");
    mkdirSync(lifecycleDir, { recursive: true });
    writeFileSync(join(lifecycleDir, "24.md"), "## Request\nbody\n");

    const text = await readLifecycleRecord({ cwd: baseDir, issueNumber: 24 });
    expect(text).toContain("body");
  });

  it("readLifecycleRecord returns null when file missing", async () => {
    const text = await readLifecycleRecord({ cwd: baseDir, issueNumber: 999 });
    expect(text).toBeNull();
  });

  it("readLedgerTexts returns markdown of all ledger files in thoughts/ledgers", async () => {
    const ledgersDir = join(baseDir, "thoughts", "ledgers");
    mkdirSync(ledgersDir, { recursive: true });
    writeFileSync(join(ledgersDir, "CONTINUITY_2026-05-01.md"), "ledger one");
    writeFileSync(join(ledgersDir, "CONTINUITY_2026-05-02.md"), "ledger two");
    writeFileSync(join(ledgersDir, "README.md"), "should be ignored");

    const ledgers = await readLedgerTexts({ cwd: baseDir });
    expect(ledgers.length).toBe(2);
    expect(ledgers.map((l) => l.text).sort()).toEqual(["ledger one", "ledger two"]);
  });

  it("readLedgerTexts returns empty array when ledger directory missing", async () => {
    const ledgers = await readLedgerTexts({ cwd: baseDir });
    expect(ledgers).toEqual([]);
  });
});
