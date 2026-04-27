// src/utils/conversation-title/format.ts

export const TITLE_STATUS = {
  INITIALIZING: "初始化",
  PLANNING: "规划中",
  EXECUTING: "执行中",
  DONE: "已完成",
  FAILED: "失败",
} as const;

export type TitleStatus = (typeof TITLE_STATUS)[keyof typeof TITLE_STATUS];

export interface TitleParts {
  readonly status: TitleStatus;
  readonly summary: string;
}

const DEFAULT_MAX_LENGTH = 50;
const ELLIPSIS = "…";
const SEPARATOR = ": ";
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
