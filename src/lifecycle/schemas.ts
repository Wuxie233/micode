import * as v from "valibot";
import type { ArtifactKind, LifecycleRecord, LifecycleState } from "./types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "./types";

const ROOT_PATH = "record";
const PATH_SEPARATOR = ".";

const LifecycleStateSchema = v.picklist(Object.values(LIFECYCLE_STATES) as readonly LifecycleState[]);
const ArtifactKindSchema = v.picklist(Object.values(ARTIFACT_KINDS) as readonly ArtifactKind[]);
const ArtifactsSchema = v.pipe(
  v.record(ArtifactKindSchema, v.array(v.string())),
  v.transform((artifacts) => artifacts as Record<ArtifactKind, string[]>),
);

export const LifecycleRecordSchema = v.object({
  issueNumber: v.number(),
  issueUrl: v.string(),
  branch: v.string(),
  worktree: v.string(),
  state: LifecycleStateSchema,
  artifacts: ArtifactsSchema,
  notes: v.array(v.string()),
  updatedAt: v.number(),
});

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
