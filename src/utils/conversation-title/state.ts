// src/utils/conversation-title/state.ts
import { buildTitle, TITLE_STATUS, type TitleStatus } from "./format";

const TITLE_THROTTLE_MS = 1000;
const DONE_FREEZE_MS = 60_000;

export const DECISION_KIND = {
  WRITE: "write",
  SKIP: "skip",
} as const;

export type DecisionKind = (typeof DECISION_KIND)[keyof typeof DECISION_KIND];

export interface DecisionInput {
  readonly sessionID: string;
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly currentTitle: string | null;
  readonly now: number;
  readonly maxLength?: number;
}

export type TitleDecision =
  | { readonly kind: typeof DECISION_KIND.WRITE; readonly title: string }
  | { readonly kind: typeof DECISION_KIND.SKIP; readonly reason: string };

interface SessionRecord {
  lastTitle: string | null;
  lastUpdateAt: number;
  doneAt: number | null;
  optedOut: boolean;
  lastSummary: string | null;
}

export interface TitleStateRegistry {
  decide(input: DecisionInput): TitleDecision;
  forget(sessionID: string): void;
  isOptedOut(sessionID: string): boolean;
  size(): number;
}

const skip = (reason: string): TitleDecision => ({ kind: DECISION_KIND.SKIP, reason });

const isUserAuthoredTitle = (current: string | null, lastWritten: string | null): boolean => {
  if (current === null || current === "") return false;
  if (lastWritten === null) return true;
  return current !== lastWritten;
};

const detectOptOut = (record: SessionRecord, current: string | null): boolean => {
  if (record.optedOut) return true;
  if (record.lastTitle === null) return false;
  return isUserAuthoredTitle(current, record.lastTitle);
};

const isDoneFrozen = (record: SessionRecord, now: number): boolean => {
  if (record.doneAt === null) return false;
  return now - record.doneAt < DONE_FREEZE_MS;
};

const isThrottled = (record: SessionRecord, candidate: string, now: number): boolean => {
  if (record.lastTitle !== candidate) return false;
  return now - record.lastUpdateAt < TITLE_THROTTLE_MS;
};

const ensureSummary = (input: DecisionInput, record: SessionRecord): string | null => {
  return input.summary ?? record.lastSummary;
};

const updateRecord = (
  record: SessionRecord,
  title: string,
  status: TitleStatus,
  summary: string | null,
  now: number,
): void => {
  record.lastTitle = title;
  record.lastUpdateAt = now;
  record.lastSummary = summary;
  if (status === TITLE_STATUS.DONE) {
    record.doneAt = now;
    return;
  }
  if (record.doneAt !== null && now - record.doneAt >= DONE_FREEZE_MS) {
    record.doneAt = null;
  }
};

const newRecord = (): SessionRecord => ({
  lastTitle: null,
  lastUpdateAt: 0,
  doneAt: null,
  optedOut: false,
  lastSummary: null,
});

export function createTitleStateRegistry(): TitleStateRegistry {
  const records = new Map<string, SessionRecord>();

  const getOrCreate = (sessionID: string): SessionRecord => {
    let record = records.get(sessionID);
    if (!record) {
      record = newRecord();
      records.set(sessionID, record);
    }
    return record;
  };

  return {
    decide(input) {
      const record = getOrCreate(input.sessionID);

      if (detectOptOut(record, input.currentTitle)) {
        record.optedOut = true;
        return skip("opted-out");
      }

      if (isDoneFrozen(record, input.now)) {
        return skip("done-frozen");
      }

      const summary = ensureSummary(input, record);
      const title = buildTitle({ status: input.status, summary: summary ?? "" }, input.maxLength);

      if (isThrottled(record, title, input.now)) {
        return skip("throttled");
      }

      updateRecord(record, title, input.status, summary, input.now);
      return { kind: DECISION_KIND.WRITE, title };
    },

    forget(sessionID) {
      records.delete(sessionID);
    },

    isOptedOut(sessionID) {
      return records.get(sessionID)?.optedOut ?? false;
    },

    size() {
      return records.size;
    },
  };
}
