import * as v from "valibot";
import type { ArtifactKind, LifecycleMode, LifecycleRecord, LifecycleState } from "./types";
import { ARTIFACT_KINDS, LIFECYCLE_MODES, LIFECYCLE_STATES } from "./types";

const ROOT_PATH = "record";
const PATH_SEPARATOR = ".";

const LifecycleStateSchema = v.picklist(Object.values(LIFECYCLE_STATES) as readonly LifecycleState[]);
const LifecycleModeSchema = v.picklist(Object.values(LIFECYCLE_MODES) as readonly LifecycleMode[]);
const ArtifactKindSchema = v.picklist(Object.values(ARTIFACT_KINDS) as readonly ArtifactKind[]);
const ArtifactsSchema = v.pipe(
  v.record(ArtifactKindSchema, v.array(v.string())),
  v.transform((artifacts) => artifacts as Record<ArtifactKind, string[]>),
);

const isPositiveIssueNumber = (issueNumber: number): boolean => Number.isSafeInteger(issueNumber) && issueNumber > 0;

export const LifecycleRecordSchema = v.pipe(
  v.object({
    issueNumber: v.number(),
    issueUrl: v.string(),
    mode: v.optional(LifecycleModeSchema, LIFECYCLE_MODES.REMOTE),
    localId: v.optional(v.nullable(v.string()), null),
    repoRoot: v.optional(v.string()),
    remoteCapable: v.optional(v.boolean()),
    branch: v.string(),
    worktree: v.string(),
    state: LifecycleStateSchema,
    artifacts: ArtifactsSchema,
    notes: v.array(v.string()),
    updatedAt: v.number(),
  }),
  v.transform(
    (record): LifecycleRecord => ({
      ...record,
      repoRoot: record.repoRoot ?? record.worktree ?? "",
      remoteCapable: record.remoteCapable ?? isPositiveIssueNumber(record.issueNumber),
    }),
  ),
  v.check(
    (record) => record.mode !== LIFECYCLE_MODES.LOCAL_ONLY || record.localId !== null,
    "localId is required for local-only lifecycle records",
  ),
  v.check(
    (record) => record.mode !== LIFECYCLE_MODES.LOCAL_ONLY || record.remoteCapable === false,
    "remoteCapable must be false for local-only lifecycle records",
  ),
);

const formatPath = (issue: v.BaseIssue<unknown>): string => {
  const path = issue.path?.map((item) => String(item.key)).join(PATH_SEPARATOR);
  if (!path) return ROOT_PATH;
  return path;
};

const formatIssue = (issue: v.BaseIssue<unknown>): string => {
  return `${formatPath(issue)}: ${issue.message}`;
};

export function parseLifecycleRecord(
  raw: unknown,
): { ok: true; record: LifecycleRecord } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(LifecycleRecordSchema, raw);
  if (parsed.success) return { ok: true, record: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}

export const StartRequestInputSchema = v.strictObject({
  summary: v.string(),
  goals: v.array(v.string()),
  constraints: v.array(v.string()),
});

export type StartRequestInputParsed = v.InferOutput<typeof StartRequestInputSchema>;

export function parseStartRequestInput(
  raw: unknown,
): { ok: true; input: StartRequestInputParsed } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(StartRequestInputSchema, raw, { abortEarly: false });
  if (parsed.success) return { ok: true, input: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
