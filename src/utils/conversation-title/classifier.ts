// src/utils/conversation-title/classifier.ts
import { summaryFromPlanPath, TITLE_STATUS, type TitleStatus } from "./format";
import { TITLE_SOURCE, type TitleSource } from "./source";

export interface ToolMilestoneInput {
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly output?: string;
}

export interface MilestoneSignal {
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
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

const sourceFromPlanPath = (path: string): TitleSource => {
  return path.endsWith(DESIGN_PATH_SUFFIX) ? TITLE_SOURCE.DESIGN_PATH : TITLE_SOURCE.PLAN_PATH;
};

const stringField = (args: Record<string, unknown> | undefined, key: string): string | null => {
  if (!args) return null;
  const value = args[key];
  return typeof value === "string" ? value : null;
};

const firstStringField = (args: Record<string, unknown> | undefined, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = stringField(args, key);
    if (value !== null) return value;
  }
  return null;
};

const detectPlanWrite = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool.toLowerCase() !== TOOL_NAMES.WRITE) return null;
  const path = firstStringField(input.args, PLAN_PATH_FIELDS);
  if (!path || !PLAN_PATH_PATTERN.test(path)) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: summaryFromPlanPath(path),
    source: sourceFromPlanPath(path),
  };
};

const detectLifecycleStart = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_START) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: stringField(input.args, "summary"),
    source: TITLE_SOURCE.LIFECYCLE_ISSUE,
  };
};

const detectLifecycleCommit = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_COMMIT) return null;
  return {
    status: TITLE_STATUS.EXECUTING,
    summary: stringField(input.args, "summary"),
    source: TITLE_SOURCE.COMMIT_TITLE,
  };
};

const FINISH_CLOSED_PATTERN = /\bclosed\b/iu;

const detectLifecycleFinish = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_FINISH) return null;
  if (!input.output || !FINISH_CLOSED_PATTERN.test(input.output)) {
    return { status: TITLE_STATUS.EXECUTING, summary: null, source: TITLE_SOURCE.LIFECYCLE_FINISH };
  }
  return { status: TITLE_STATUS.DONE, summary: null, source: TITLE_SOURCE.LIFECYCLE_FINISH };
};

const detectImplementerSpawn = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.SPAWN_AGENT) return null;
  const text = JSON.stringify(input.args ?? {});
  if (!/"agent"\s*:\s*"(implementer-[^"]+|executor)"/u.test(text)) return null;
  return { status: TITLE_STATUS.EXECUTING, summary: null, source: TITLE_SOURCE.COMMIT_TITLE };
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
