// src/utils/conversation-title/format.ts

export const TITLE_STATUS = {
  INITIALIZING: "初始化",
  PLANNING: "规划中",
  EXECUTING: "执行中",
  DONE: "已完成",
  FAILED: "失败",
  BLOCKED: "阻塞",
  REVIEW_CHANGES_REQUESTED: "需修改",
} as const;

export type TitleStatus = (typeof TITLE_STATUS)[keyof typeof TITLE_STATUS];

export const CONCLUSIVE_STATUSES: readonly TitleStatus[] = [
  TITLE_STATUS.DONE,
  TITLE_STATUS.FAILED,
  TITLE_STATUS.BLOCKED,
  TITLE_STATUS.REVIEW_CHANGES_REQUESTED,
];

export interface TitleParts {
  readonly status: TitleStatus;
  readonly summary: string;
}

export interface TopicTitleParts {
  readonly topic: string;
  readonly status: TitleStatus;
}

export interface IssueTitleParts {
  readonly issueNumber: number | null;
  readonly topic: string;
  readonly status: TitleStatus;
}

const DEFAULT_MAX_LENGTH = 50;
const ELLIPSIS = "…";
const SEPARATOR = ": ";
const STATUS_SUFFIX_SEPARATOR = " · ";
const ISSUE_PREFIX_SYMBOL = "#";
const ISSUE_SEPARATOR_FULLWIDTH = "：";
const ISSUE_PREFIX_SPACE = " ";
const WHITESPACE_PATTERN = /\s+/g;
const SPACE = " ";
const EMPTY = "";

const normalizeWhitespace = (text: string): string => text.replace(WHITESPACE_PATTERN, SPACE).trim();

const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return text.slice(0, max);
  return `${text.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
};

export function buildTitle(parts: TitleParts, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const status = parts.status;
  const summary = normalizeWhitespace(parts.summary);
  if (summary.length === 0) return status;

  const fixed = `${status}${SEPARATOR}`;
  const remaining = maxLength - fixed.length;
  if (remaining <= 0) return truncate(status, maxLength);

  return `${fixed}${truncate(summary, remaining)}`;
}

const conclusiveSuffix = (status: TitleStatus): string => `${STATUS_SUFFIX_SEPARATOR}${status}`;

const buildConclusiveTitle = (topic: string, status: TitleStatus, maxLength: number): string => {
  const suffix = conclusiveSuffix(status);
  const remaining = maxLength - suffix.length;
  if (remaining <= 0) return truncate(status, maxLength);
  return `${truncate(topic, remaining)}${suffix}`;
};

export function buildTopicTitle(parts: TopicTitleParts, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const topic = normalizeWhitespace(parts.topic);
  if (topic.length === 0) return parts.status;
  if (!CONCLUSIVE_STATUSES.includes(parts.status)) return truncate(topic, maxLength);
  return buildConclusiveTitle(topic, parts.status, maxLength);
}

const buildIssueFixedPrefix = (issueNumber: number, status: TitleStatus): string => {
  return `${ISSUE_PREFIX_SYMBOL}${issueNumber}${ISSUE_PREFIX_SPACE}${status}${ISSUE_SEPARATOR_FULLWIDTH}`;
};

const buildIssueStatusOnly = (issueNumber: number, status: TitleStatus): string => {
  return `${ISSUE_PREFIX_SYMBOL}${issueNumber}${ISSUE_PREFIX_SPACE}${status}`;
};

export function buildIssueAwareTitle(parts: IssueTitleParts, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const topic = normalizeWhitespace(parts.topic);

  if (parts.issueNumber === null) {
    return buildTopicTitle({ topic, status: parts.status }, maxLength);
  }

  if (topic.length === 0) {
    const statusOnly = buildIssueStatusOnly(parts.issueNumber, parts.status);
    return truncate(statusOnly, maxLength);
  }

  const fixed = buildIssueFixedPrefix(parts.issueNumber, parts.status);
  const remaining = maxLength - fixed.length;
  if (remaining <= 0) return truncate(parts.status, maxLength);
  return `${fixed}${truncate(topic, remaining)}`;
}

const SLUG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}-/;
const PLAN_PATH_PATTERN = /thoughts\/shared\/plans\/([^/]+?)(?:-design)?\.md$/u;
const SLUG_SEPARATORS = /[-_]+/g;

export function summaryFromPlanPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const match = PLAN_PATH_PATTERN.exec(path);
  if (!match) return null;
  const stem = match[1] ?? EMPTY;
  const dateless = stem.replace(SLUG_DATE_PATTERN, EMPTY);
  if (dateless.length === 0) return null;
  return dateless.replace(SLUG_SEPARATORS, SPACE);
}

const FIRST_TEXT_LIMIT = 60;

export function summaryFromUserMessage(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = normalizeWhitespace(text);
  if (cleaned.length === 0) return null;
  return cleaned.length > FIRST_TEXT_LIMIT ? cleaned.slice(0, FIRST_TEXT_LIMIT) : cleaned;
}
