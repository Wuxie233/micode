import { containsSecret, scrubSummary } from "./scrub";
import type { NotificationStatus } from "./types";

export interface ComposeInput {
  readonly status: NotificationStatus;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
  readonly maxSummaryChars: number;
}

const GENERIC_TITLE = "micode task";
const REVIEW_INSTRUCTION = "Return to OpenCode to review.";
const REDACTED_PLACEHOLDER = "[redacted]";
const TITLE_MAX_CHARS = 80;
const LINE_BREAK = "\n";

const sanitizeTitle = (title: string): string => {
  const cleaned = scrubSummary(title, TITLE_MAX_CHARS);
  if (cleaned.length === 0) return GENERIC_TITLE;
  if (containsSecret(title) || containsSecret(cleaned)) return REDACTED_PLACEHOLDER;
  return cleaned;
};

const sanitizeSummary = (summary: string, maxSummaryChars: number): string => {
  const cleaned = scrubSummary(summary, maxSummaryChars);
  if (cleaned.length === 0) return "";
  if (containsSecret(summary) || containsSecret(cleaned)) return REDACTED_PLACEHOLDER;
  return cleaned;
};

const formatReference = (reference: string | null): string => {
  if (reference === null) return "";
  const cleaned = scrubSummary(reference, TITLE_MAX_CHARS * 2);
  if (cleaned.length === 0) return "";
  if (containsSecret(reference) || containsSecret(cleaned)) return `${LINE_BREAK}${REDACTED_PLACEHOLDER}`;
  return `${LINE_BREAK}${cleaned}`;
};

export function composeMessage(input: ComposeInput): string {
  const title = sanitizeTitle(input.title);
  const summary = sanitizeSummary(input.summary, input.maxSummaryChars);
  const summaryLine = summary.length > 0 ? `${LINE_BREAK}${summary}` : "";
  const reference = formatReference(input.reference);
  return `[${input.status}] ${title}${summaryLine}${reference}${LINE_BREAK}${REVIEW_INSTRUCTION}`;
}
