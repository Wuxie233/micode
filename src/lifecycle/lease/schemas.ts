import * as v from "valibot";

const ROOT_PATH = "lease";
const PATH_SEPARATOR = ".";

export const LeaseRecordSchema = v.object({
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  owner: v.pipe(v.string(), v.minLength(1)),
  host: v.string(),
  branch: v.pipe(v.string(), v.minLength(1)),
  worktree: v.pipe(v.string(), v.minLength(1)),
  acquiredAt: v.number(),
  heartbeatAt: v.number(),
  ttlMs: v.pipe(v.number(), v.minValue(0)),
});

export type LeaseRecordParsed = v.InferOutput<typeof LeaseRecordSchema>;

const formatPath = (issue: v.BaseIssue<unknown>): string => {
  const path = issue.path?.map((item) => String(item.key)).join(PATH_SEPARATOR);
  return path && path.length > 0 ? path : ROOT_PATH;
};

const formatIssue = (issue: v.BaseIssue<unknown>): string => `${formatPath(issue)}: ${issue.message}`;

export function parseLeaseRecord(
  raw: unknown,
): { ok: true; lease: LeaseRecordParsed } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(LeaseRecordSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, lease: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
