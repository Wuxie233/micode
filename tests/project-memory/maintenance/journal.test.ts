import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  appendMaintenanceJournal,
  journalPathFor,
  type MaintenanceJournalEvent,
  readMaintenanceJournal,
} from "@/project-memory/maintenance/journal";

const PROJECT_ID = "project-journal";
const ACTION_SWEEP = "sweep";
const ACTION_SNAPSHOT = "snapshot";
const ENTRY_ID = "entry-one";
const LONG_DETAIL_LENGTH = 300;
const MAX_STORED_DETAIL_LENGTH = 240;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memjournal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<MaintenanceJournalEvent> = {}): MaintenanceJournalEvent {
  return {
    projectId: PROJECT_ID,
    action: ACTION_SWEEP,
    entryIds: [ENTRY_ID],
    reasons: ["missing_source"],
    counts: { stale: 1 },
    at: 1,
    ...overrides,
  };
}

describe("maintenance journal", () => {
  it("appends events to a project jsonl file and reads them in order", async () => {
    const first = event({ action: ACTION_SWEEP, at: 1 });
    const second = event({ action: ACTION_SNAPSHOT, at: 2, counts: { stale: 0, active: 2 } });

    const writtenPath = await appendMaintenanceJournal(first, { dir });
    await appendMaintenanceJournal(second, { dir });

    expect(writtenPath).toBe(join(dir, `${PROJECT_ID}.jsonl`));
    expect(writtenPath.startsWith(process.cwd())).toBe(false);
    expect(existsSync(dirname(writtenPath))).toBe(true);
    expect(await readMaintenanceJournal(PROJECT_ID, { dir })).toEqual([first, second]);
  });

  it("truncates long journal details before persisting", async () => {
    const longDetail = "x".repeat(LONG_DETAIL_LENGTH);
    const journalEvent = event({ details: longDetail, entrySummaries: [longDetail] });

    const writtenPath = await appendMaintenanceJournal(journalEvent, { dir });
    const [stored] = await readMaintenanceJournal(PROJECT_ID, { dir });
    const rawText = readFileSync(writtenPath, "utf8");

    expect(stored?.details).toHaveLength(MAX_STORED_DETAIL_LENGTH);
    expect(stored?.entrySummaries?.[0]).toHaveLength(MAX_STORED_DETAIL_LENGTH);
    expect(rawText).not.toContain(longDetail);
  });

  it("redacts credential-like substrings from journal details and entry summaries", async () => {
    const rawBearerToken = "Bearer abc.def.ghi";
    const rawApiKey = "api_key=abc123secret";
    const rawPassword = "password: hunter2";
    const rawSecret = "secret token-value";
    const rawSkToken = "sk-1234567890abcdef1234567890abcdef";
    const journalEvent = event({
      details: `failed with ${rawBearerToken} and ${rawApiKey}`,
      entrySummaries: [`stored ${rawPassword}`, `reported ${rawSecret}`, `provider ${rawSkToken}`],
    });

    const writtenPath = await appendMaintenanceJournal(journalEvent, { dir });
    const [stored] = await readMaintenanceJournal(PROJECT_ID, { dir });
    const rawText = readFileSync(writtenPath, "utf8");
    const serializedStored = JSON.stringify(stored);

    for (const rawSecretValue of [rawBearerToken, rawApiKey, rawPassword, rawSecret, rawSkToken]) {
      expect(rawText).not.toContain(rawSecretValue);
      expect(serializedStored).not.toContain(rawSecretValue);
    }

    expect(rawText).toContain("[REDACTED]");
    expect(serializedStored).toContain("[REDACTED]");
  });

  it("applies read limits after preserving append order", async () => {
    await appendMaintenanceJournal(event({ action: "first", at: 1 }), { dir });
    await appendMaintenanceJournal(event({ action: "second", at: 2 }), { dir });

    expect(await readMaintenanceJournal(PROJECT_ID, { dir, limit: 1 })).toEqual([event({ action: "second", at: 2 })]);
  });

  it("builds default journal paths from config", () => {
    expect(journalPathFor(PROJECT_ID, new Date("2026-05-16T00:00:00.000Z"))).toContain(`${PROJECT_ID}.jsonl`);
  });
});
