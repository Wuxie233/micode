// src/utils/conversation-title/state.ts
import { buildTopicTitle, CONCLUSIVE_STATUSES, type TitleStatus } from "./format";
import { compareConfidence, type TitleSource } from "./source";

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
  readonly source: TitleSource;
  readonly currentTitle: string | null;
  readonly now: number;
  readonly maxLength?: number;
}

export interface SessionTopic {
  readonly topic: string | null;
  readonly source: TitleSource | null;
}

export type TitleDecision =
  | { readonly kind: typeof DECISION_KIND.WRITE; readonly title: string }
  | { readonly kind: typeof DECISION_KIND.SKIP; readonly reason: string };

interface SessionRecord {
  lastTitle: string | null;
  lastUpdateAt: number;
  doneAt: number | null;
  optedOut: boolean;
  topic: string | null;
  topicSource: TitleSource | null;
}

export interface TitleStateRegistry {
  decide(input: DecisionInput): TitleDecision;
  getTopic(sessionID: string): SessionTopic;
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

const canReplaceTopic = (record: SessionRecord, source: TitleSource, allowEqualConfidence: boolean): boolean => {
  if (record.topic === null) return true;
  if (record.topicSource === null) return true;
  const confidence = compareConfidence(source, record.topicSource);
  if (confidence > 0) return true;
  return allowEqualConfidence && confidence === 0;
};

const applyTopic = (record: SessionRecord, input: DecisionInput, allowEqualConfidence: boolean): boolean => {
  const incomingTopic = input.summary;
  if (incomingTopic === null || incomingTopic === "") return false;
  if (!canReplaceTopic(record, input.source, allowEqualConfidence)) return false;
  record.topic = incomingTopic;
  record.topicSource = input.source;
  return true;
};

const isDoneExpired = (record: SessionRecord, now: number): boolean => {
  if (record.doneAt === null) return false;
  return now - record.doneAt >= DONE_FREEZE_MS;
};

const updateDoneAt = (record: SessionRecord, status: TitleStatus, now: number, replacedTopic: boolean): void => {
  if (CONCLUSIVE_STATUSES.includes(status)) {
    record.doneAt = now;
    return;
  }
  if (replacedTopic && isDoneExpired(record, now)) record.doneAt = null;
};

const updateRecord = (
  record: SessionRecord,
  title: string,
  status: TitleStatus,
  now: number,
  replacedTopic: boolean,
): void => {
  record.lastTitle = title;
  record.lastUpdateAt = now;
  updateDoneAt(record, status, now, replacedTopic);
};

const newRecord = (): SessionRecord => ({
  lastTitle: null,
  lastUpdateAt: 0,
  doneAt: null,
  optedOut: false,
  topic: null,
  topicSource: null,
});

const readTopic = (record: SessionRecord | undefined): SessionTopic => ({
  topic: record?.topic ?? null,
  source: record?.topicSource ?? null,
});

const getOrCreate = (records: Map<string, SessionRecord>, sessionID: string): SessionRecord => {
  let record = records.get(sessionID);
  if (!record) {
    record = newRecord();
    records.set(sessionID, record);
  }
  return record;
};

const decideForRecord = (record: SessionRecord, input: DecisionInput): TitleDecision => {
  if (detectOptOut(record, input.currentTitle)) {
    record.optedOut = true;
    return skip("opted-out");
  }

  if (isDoneFrozen(record, input.now)) {
    return skip("done-frozen");
  }

  const doneExpired = isDoneExpired(record, input.now);
  const replacedTopic = applyTopic(record, input, doneExpired);
  const title = buildTopicTitle({ topic: record.topic ?? "", status: input.status }, input.maxLength);

  if (isThrottled(record, title, input.now)) {
    return skip("throttled");
  }

  updateRecord(record, title, input.status, input.now, replacedTopic);
  return { kind: DECISION_KIND.WRITE, title };
};

export function createTitleStateRegistry(): TitleStateRegistry {
  const records = new Map<string, SessionRecord>();

  return {
    decide(input) {
      return decideForRecord(getOrCreate(records, input.sessionID), input);
    },

    getTopic(sessionID) {
      return readTopic(records.get(sessionID));
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
