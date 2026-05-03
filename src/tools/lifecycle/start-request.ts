import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { LIFECYCLE_STATES, type LifecycleHandle, type LifecycleRecord, type StartRequestInput } from "@/lifecycle";
import { sequenceSchema } from "@/tools/sequence";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Start an issue-driven lifecycle request.

Calls the lifecycle handle to create the GitHub issue, branch, and worktree, then returns the lifecycle summary.`;

const PREFLIGHT_CATEGORY = "pre_flight_failed";
const ISSUES_DISABLED_CATEGORY = "issues_disabled_upstream";
const WORKTREE_CONFLICT_CATEGORY = "worktree_conflict";
const PREFLIGHT_HEADER = "## Lifecycle pre-flight failed";
const ISSUES_DISABLED_HEADER = "## Lifecycle aborted: issues disabled on upstream";
const WORKTREE_CONFLICT_HEADER = "## Worktree conflict";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "|---|---|---|---|";
const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER;
const ABORTED_ISSUE_LABEL = "(aborted)";
const ABORTED_BRANCH_LABEL = "(not created)";
const ABORTED_WORKTREE_LABEL = "(not created)";
const INVALID_REQUEST_HEADER = "## Invalid lifecycle start request";
const JSON_OBJECT_PREFIX = "{";
const JSON_ARRAY_PREFIX = "[";
const FIELD_GOALS = "goals";
const FIELD_CONSTRAINTS = "constraints";
const FIELD_SUMMARY = "summary";
const INDEX_KEY_PATTERN = /^(?:0|[1-9]\d*)$/u;

interface FieldSuccess {
  readonly ok: true;
  readonly values: string[];
}

interface FieldFailure {
  readonly ok: false;
  readonly message: string;
}

type FieldResult = FieldSuccess | FieldFailure;

type DecodeResult = { readonly ok: true; readonly value: unknown } | FieldFailure;

type NormalizeResult = { readonly ok: true; readonly input: StartRequestInput } | FieldFailure;

const isAbortedSentinel = (issueNumber: number): boolean => issueNumber === ABORTED_ISSUE_NUMBER;

const displayIssue = (record: LifecycleRecord): string => {
  return isAbortedSentinel(record.issueNumber) ? ABORTED_ISSUE_LABEL : String(record.issueNumber);
};

const displayBranch = (record: LifecycleRecord): string => {
  return isAbortedSentinel(record.issueNumber) ? ABORTED_BRANCH_LABEL : record.branch;
};

const displayWorktree = (record: LifecycleRecord): string => {
  return isAbortedSentinel(record.issueNumber) ? ABORTED_WORKTREE_LABEL : record.worktree;
};

const fieldFailure = (field: string, reason: string): FieldFailure => ({
  ok: false,
  message: `Invalid ${field}: ${reason}`,
});

const expectedField = (field: string): FieldFailure => {
  return fieldFailure(field, "expected strings, arrays of strings, stringified JSON, or indexed records of strings.");
};

const decodeJson = (value: unknown): DecodeResult => {
  if (typeof value !== "string") return { ok: true, value };
  const text = value.trim();
  if (!text.startsWith(JSON_OBJECT_PREFIX) && !text.startsWith(JSON_ARRAY_PREFIX)) return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fieldFailure("JSON", "malformed stringified JSON.");
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isIndexedRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => INDEX_KEY_PATTERN.test(key));
};

const valuesFromArray = (field: string, values: readonly unknown[]): FieldResult => {
  if (!values.every((value) => typeof value === "string")) return expectedField(field);
  return { ok: true, values: [...values] };
};

const valuesFromIndexedRecord = (field: string, record: Record<string, unknown>): FieldResult => {
  const values = Object.entries(record)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => value);
  return valuesFromArray(field, values);
};

const normalizeField = (field: string, raw: unknown): FieldResult => {
  const decoded = decodeJson(raw);
  if (!decoded.ok) return fieldFailure(field, decoded.message);
  if (Array.isArray(decoded.value)) return valuesFromArray(field, decoded.value);
  if (typeof decoded.value === "string") return { ok: true, values: [decoded.value] };
  if (isIndexedRecord(decoded.value)) return valuesFromIndexedRecord(field, decoded.value);
  return expectedField(field);
};

const normalizeRequest = (raw: Record<string, unknown>): NormalizeResult => {
  if (typeof raw[FIELD_SUMMARY] !== "string") return fieldFailure(FIELD_SUMMARY, "expected a string.");
  const goals = normalizeField(FIELD_GOALS, raw[FIELD_GOALS]);
  if (!goals.ok) return goals;
  const constraints = normalizeField(FIELD_CONSTRAINTS, raw[FIELD_CONSTRAINTS]);
  if (!constraints.ok) return constraints;
  return { ok: true, input: { summary: raw[FIELD_SUMMARY], goals: goals.values, constraints: constraints.values } };
};

const formatInvalidRequest = (message: string): string => `${INVALID_REQUEST_HEADER}${DOUBLE_LINE_BREAK}${message}`;

const formatRecordRow = (record: LifecycleRecord): string => {
  return `| ${displayIssue(record)} | \`${displayBranch(record)}\` | \`${displayWorktree(record)}\` | \`${record.state}\` |`;
};

const formatRecordTable = (record: LifecycleRecord): string => {
  return [TABLE_HEADER, TABLE_SEPARATOR, formatRecordRow(record)].join(LINE_BREAK);
};

const formatNotes = (notes: readonly string[]): string => {
  if (notes.length === 0) return "";
  return `${notes.join(LINE_BREAK)}${DOUBLE_LINE_BREAK}`;
};

const headerFor = (record: LifecycleRecord): string => {
  const note = record.notes[0] ?? "";
  if (note.startsWith(ISSUES_DISABLED_CATEGORY)) return ISSUES_DISABLED_HEADER;
  if (note.startsWith(WORKTREE_CONFLICT_CATEGORY)) return WORKTREE_CONFLICT_HEADER;
  return PREFLIGHT_HEADER;
};

const formatRecord = (record: LifecycleRecord): string => {
  const table = formatRecordTable(record);
  if (record.state !== LIFECYCLE_STATES.ABORTED) return table;
  return `${headerFor(record)}${DOUBLE_LINE_BREAK}${formatNotes(record.notes)}${table}`;
};

const formatThrown = (error: unknown): string => {
  const message = extractErrorMessage(error);
  if (message.startsWith(ISSUES_DISABLED_CATEGORY)) return `${ISSUES_DISABLED_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  if (message.startsWith(WORKTREE_CONFLICT_CATEGORY))
    return `${WORKTREE_CONFLICT_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  if (message.startsWith(PREFLIGHT_CATEGORY)) return `${PREFLIGHT_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  throw error;
};

export function createLifecycleStartRequestTool(handle: LifecycleHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      summary: tool.schema.string().describe("Short request summary used as the issue title"),
      goals: sequenceSchema(tool.schema.string()).describe("Goals the lifecycle request should accomplish"),
      constraints: sequenceSchema(tool.schema.string()).describe("Constraints that must be respected"),
    },
    execute: async (args) => {
      const normalized = normalizeRequest(args);
      if (!normalized.ok) return formatInvalidRequest(normalized.message);
      try {
        const record = await handle.start(normalized.input);
        return formatRecord(record);
      } catch (error) {
        return formatThrown(error);
      }
    },
  });
}
