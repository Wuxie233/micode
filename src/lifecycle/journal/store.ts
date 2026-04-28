import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { parseJournalEvent } from "./schemas";
import type { JournalEvent, JournalEventInput } from "./types";

const LOG_SCOPE = "lifecycle.journal";
const MIN_ISSUE_NUMBER = 1;
const NEWLINE = "\n";

export interface JournalStoreOptions {
  readonly baseDir?: string;
  readonly suffix?: string;
  readonly now?: () => number;
}

export interface JournalStore {
  readonly append: (issueNumber: number, input: JournalEventInput) => Promise<JournalEvent>;
  readonly list: (issueNumber: number) => Promise<readonly JournalEvent[]>;
  readonly lastSeq: (issueNumber: number) => Promise<number>;
}

const validateIssueNumber = (issueNumber: number): void => {
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return;
  throw new Error(`Invalid issue number: ${issueNumber}`);
};

const ensureDir = (dir: string): void => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
};

const readEvents = (location: string): readonly JournalEvent[] => {
  if (!existsSync(location)) return [];
  let content: string;
  try {
    content = readFileSync(location, "utf8");
  } catch (error) {
    log.warn(LOG_SCOPE, `read failed: ${location}: ${extractErrorMessage(error)}`);
    return [];
  }
  const events: JournalEvent[] = [];
  for (const line of content.split(NEWLINE)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      log.warn(LOG_SCOPE, `malformed journal line in ${location}: ${extractErrorMessage(error)}`);
      continue;
    }
    const parsed = parseJournalEvent(raw);
    if (!parsed.ok) {
      log.warn(LOG_SCOPE, `invalid journal entry in ${location}: ${parsed.issues.join("; ")}`);
      continue;
    }
    events.push(parsed.event);
  }
  return events;
};

const createEvent = (issueNumber: number, input: JournalEventInput, seq: number, at: number): JournalEvent => ({
  kind: input.kind,
  issueNumber,
  seq,
  at,
  batchId: input.batchId ?? null,
  taskId: input.taskId ?? null,
  attempt: input.attempt ?? 0,
  summary: input.summary,
  commitMarker: input.commitMarker ?? null,
  reviewOutcome: input.reviewOutcome ?? null,
});

export function createJournalStore(options: JournalStoreOptions = {}): JournalStore {
  const baseDir = options.baseDir ?? config.lifecycle.lifecycleDir;
  const suffix = options.suffix ?? config.lifecycle.journalSuffix;
  const now = options.now ?? Date.now;

  const pathFor = (issueNumber: number): string => {
    validateIssueNumber(issueNumber);
    return join(baseDir, `${issueNumber}${suffix}`);
  };

  const lastSeqFor = (issueNumber: number): number => {
    const events = readEvents(pathFor(issueNumber));
    if (events.length === 0) return 0;
    return events[events.length - 1]?.seq ?? 0;
  };

  const nextSeqAt = (location: string): number => {
    const events = readEvents(location);
    const last = events[events.length - 1];
    return (last?.seq ?? 0) + 1;
  };

  return {
    async append(issueNumber, input) {
      const location = pathFor(issueNumber);
      ensureDir(baseDir);
      const seq = nextSeqAt(location);
      const event = createEvent(issueNumber, input, seq, now());
      appendFileSync(location, `${JSON.stringify(event)}${NEWLINE}`);
      return event;
    },

    async list(issueNumber) {
      return readEvents(pathFor(issueNumber));
    },

    async lastSeq(issueNumber) {
      return lastSeqFor(issueNumber);
    },
  };
}
