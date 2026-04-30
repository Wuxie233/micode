// src/utils/conversation-title/classifier.ts
import { summaryFromPlanPath, TITLE_STATUS, type TitleStatus } from "./format";
import { isToolLikeTopic, TITLE_SOURCE, type TitleSource } from "./source";

export interface ToolMilestoneInput {
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly output?: string;
}

export interface MilestoneSignal {
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
  readonly issueNumber: number | null;
}

const PLAN_PATH_FIELDS = ["filePath", "path"] as const;
const TOOL_NAMES = {
  WRITE: "write",
  LIFECYCLE_START: "lifecycle_start_request",
  LIFECYCLE_COMMIT: "lifecycle_commit",
  LIFECYCLE_FINISH: "lifecycle_finish",
  SPAWN_AGENT: "spawn_agent",
} as const;

const PLAN_PATH_PATTERN = /thoughts\/shared\/plans\/[^/]+\.md$/u;
const DESIGN_PATH_SUFFIX = "-design.md";
const TABLE_ROW_PATTERN = /^\|\s*(\d+)\s*\|/mu;
const BRANCH_SLUG_PATTERN = /issue\/(\d+)-/u;

const sourceFromPlanPath = (path: string): TitleSource => {
  return path.endsWith(DESIGN_PATH_SUFFIX) ? TITLE_SOURCE.DESIGN_PATH : TITLE_SOURCE.PLAN_PATH;
};

const stringField = (args: Record<string, unknown> | undefined, key: string): string | null => {
  if (!args) return null;
  const value = args[key];
  return typeof value === "string" ? value : null;
};

const positiveIntegerField = (args: Record<string, unknown> | undefined, key: string): number | null => {
  if (!args) return null;
  const value = args[key];
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value)) return null;
  if (value <= 0) return null;
  return value;
};

const firstStringField = (args: Record<string, unknown> | undefined, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = stringField(args, key);
    if (value !== null) return value;
  }
  return null;
};

const positiveMatch = (match: RegExpExecArray | null): number | null => {
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
};

const parseIssueNumberFromOutput = (output: string | undefined): number | null => {
  if (!output) return null;
  const tableNumber = positiveMatch(TABLE_ROW_PATTERN.exec(output));
  if (tableNumber !== null) return tableNumber;
  return positiveMatch(BRANCH_SLUG_PATTERN.exec(output));
};

const sanitizeSummary = (summary: string | null): string | null => {
  if (summary === null) return null;
  if (isToolLikeTopic(summary)) return null;
  return summary;
};

const detectPlanWrite = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool.toLowerCase() !== TOOL_NAMES.WRITE) return null;
  const path = firstStringField(input.args, PLAN_PATH_FIELDS);
  if (!path || !PLAN_PATH_PATTERN.test(path)) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: summaryFromPlanPath(path),
    source: sourceFromPlanPath(path),
    issueNumber: null,
  };
};

const detectLifecycleStart = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_START) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: sanitizeSummary(stringField(input.args, "summary")),
    source: TITLE_SOURCE.LIFECYCLE_ISSUE,
    issueNumber: parseIssueNumberFromOutput(input.output),
  };
};

const detectLifecycleCommit = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_COMMIT) return null;
  return {
    status: TITLE_STATUS.EXECUTING,
    summary: sanitizeSummary(stringField(input.args, "summary")),
    source: TITLE_SOURCE.COMMIT_TITLE,
    issueNumber: positiveIntegerField(input.args, "issue_number"),
  };
};

const FINISH_CLOSED_PATTERN = /\bclosed\b/iu;

const detectLifecycleFinish = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_FINISH) return null;
  const issueNumber = positiveIntegerField(input.args, "issue_number");
  if (!input.output || !FINISH_CLOSED_PATTERN.test(input.output)) {
    return { status: TITLE_STATUS.EXECUTING, summary: null, source: TITLE_SOURCE.LIFECYCLE_FINISH, issueNumber };
  }
  return { status: TITLE_STATUS.DONE, summary: null, source: TITLE_SOURCE.LIFECYCLE_FINISH, issueNumber };
};

const detectImplementerSpawn = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.SPAWN_AGENT) return null;
  const text = JSON.stringify(input.args ?? {});
  if (!/"agent"\s*:\s*"(implementer-[^"]+|executor)"/u.test(text)) return null;
  return { status: TITLE_STATUS.EXECUTING, summary: null, source: TITLE_SOURCE.COMMIT_TITLE, issueNumber: null };
};

const DETECTORS = [
  detectLifecycleStart,
  detectLifecycleCommit,
  detectLifecycleFinish,
  detectPlanWrite,
  detectImplementerSpawn,
] as const;

export function classifyToolMilestone(input: ToolMilestoneInput): MilestoneSignal | null {
  for (const detector of DETECTORS) {
    const signal = detector(input);
    if (signal) return signal;
  }
  return null;
}
