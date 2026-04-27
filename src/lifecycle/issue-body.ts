import { extractBetween, ISSUE_BODY_MARKERS, replaceBetween } from "./issue-body-markers";
import type { ArtifactKind, LifecycleRecord, LifecycleState } from "./types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "./types";

const EMPTY_BODY = "";
const LINE_BREAK = "\n";
const STATE_PREFIX = "state:";
const STATE_PATTERN = /^state:\s*/i;
const TABLE_BOUNDARY = "|";
const TABLE_HEADER = "| Kind | Pointer |";
const TABLE_SEPARATOR = "| --- | --- |";
const CHECKED = "x";
const UNCHECKED = " ";

const LIFECYCLE_STATE_VALUES: readonly string[] = Object.values(LIFECYCLE_STATES);
const ARTIFACT_KIND_VALUES: readonly string[] = Object.values(ARTIFACT_KINDS);

interface ArtifactRow {
  readonly kind: ArtifactKind;
  readonly pointer: string;
}

const createArtifacts = (): Record<ArtifactKind, string[]> => ({
  [ARTIFACT_KINDS.DESIGN]: [],
  [ARTIFACT_KINDS.PLAN]: [],
  [ARTIFACT_KINDS.LEDGER]: [],
  [ARTIFACT_KINDS.COMMIT]: [],
  [ARTIFACT_KINDS.PR]: [],
  [ARTIFACT_KINDS.WORKTREE]: [],
});

const isLifecycleState = (value: string): value is LifecycleState => LIFECYCLE_STATE_VALUES.includes(value);

const isArtifactKind = (value: string): value is ArtifactKind => ARTIFACT_KIND_VALUES.includes(value);

const renderState = (state: LifecycleState): string => `${STATE_PREFIX} ${state}`;

const renderArtifacts = (artifacts: LifecycleRecord["artifacts"]): string => {
  const rows = Object.values(ARTIFACT_KINDS).flatMap((kind) => {
    return artifacts[kind].map((pointer) => `${TABLE_BOUNDARY} ${kind} ${TABLE_BOUNDARY} ${pointer} ${TABLE_BOUNDARY}`);
  });

  return [TABLE_HEADER, TABLE_SEPARATOR, ...rows].join(LINE_BREAK);
};

const renderChecklist = (state: LifecycleState): string => {
  return Object.values(LIFECYCLE_STATES)
    .map((candidate) => `- [${candidate === state ? CHECKED : UNCHECKED}] ${candidate}`)
    .join(LINE_BREAK);
};

const parseState = (content: string | null): LifecycleState | undefined => {
  if (content === null) return undefined;
  const state = content.replace(STATE_PATTERN, EMPTY_BODY).trim();
  if (!isLifecycleState(state)) return undefined;
  return state;
};

const parseArtifactRow = (line: string): ArtifactRow | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TABLE_BOUNDARY)) return null;
  if (!trimmed.endsWith(TABLE_BOUNDARY)) return null;
  const cells = trimmed
    .slice(1, -1)
    .split(TABLE_BOUNDARY)
    .map((cell) => cell.trim());
  const [kind, pointer] = cells;

  if (!kind || !pointer) return null;
  if (!isArtifactKind(kind)) return null;
  return { kind, pointer };
};

const parseArtifacts = (content: string | null): Record<ArtifactKind, readonly string[]> | undefined => {
  if (content === null) return undefined;
  const artifacts = createArtifacts();

  for (const line of content.split(LINE_BREAK)) {
    const row = parseArtifactRow(line);
    if (row === null) continue;
    artifacts[row.kind].push(row.pointer);
  }

  return artifacts;
};

export function renderIssueBody(record: LifecycleRecord, original: string | null): string {
  let body = original ?? EMPTY_BODY;
  body = replaceBetween(body, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END, renderState(record.state));
  body = replaceBetween(
    body,
    ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN,
    ISSUE_BODY_MARKERS.ARTIFACTS_END,
    renderArtifacts(record.artifacts),
  );
  return replaceBetween(
    body,
    ISSUE_BODY_MARKERS.CHECKLIST_BEGIN,
    ISSUE_BODY_MARKERS.CHECKLIST_END,
    renderChecklist(record.state),
  );
}

export function parseIssueBody(body: string): Partial<LifecycleRecord> {
  const state = parseState(extractBetween(body, ISSUE_BODY_MARKERS.STATE_BEGIN, ISSUE_BODY_MARKERS.STATE_END));
  const artifacts = parseArtifacts(
    extractBetween(body, ISSUE_BODY_MARKERS.ARTIFACTS_BEGIN, ISSUE_BODY_MARKERS.ARTIFACTS_END),
  );

  if (!state && !artifacts) return {};
  if (!state) return { artifacts };
  if (!artifacts) return { state };
  return { state, artifacts };
}
