import * as v from "valibot";

import type { JournalEventKind } from "./types";
import { JOURNAL_EVENT_KINDS } from "./types";

const ROOT_PATH = "event";
const PATH_SEPARATOR = ".";

const KindSchema = v.picklist(Object.values(JOURNAL_EVENT_KINDS) as readonly JournalEventKind[]);
const ReviewOutcomeSchema = v.nullable(v.picklist(["approved", "changes_requested", "blocked"] as const));

export const JournalEventSchema = v.strictObject({
  kind: KindSchema,
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  seq: v.pipe(v.number(), v.minValue(0)),
  at: v.number(),
  batchId: v.nullable(v.string()),
  taskId: v.nullable(v.string()),
  attempt: v.pipe(v.number(), v.minValue(0)),
  summary: v.string(),
  commitMarker: v.nullable(v.string()),
  reviewOutcome: ReviewOutcomeSchema,
});

export type JournalEventParsed = v.InferOutput<typeof JournalEventSchema>;

const formatPath = (issue: v.BaseIssue<unknown>): string => {
  const path = issue.path?.map((item) => String(item.key)).join(PATH_SEPARATOR);
  return path && path.length > 0 ? path : ROOT_PATH;
};

const formatIssue = (issue: v.BaseIssue<unknown>): string => `${formatPath(issue)}: ${issue.message}`;

export function parseJournalEvent(
  raw: unknown,
): { ok: true; event: JournalEventParsed } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(JournalEventSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, event: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
