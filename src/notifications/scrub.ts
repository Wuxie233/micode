import { detectSecret } from "@/utils/secret-detect";

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const ELLIPSIS = "...";
const MIN_TRUNCATION_BUDGET = ELLIPSIS.length + 1;

export function scrubSummary(input: string, maxChars: number): string {
  const stripped = input.replace(CONTROL_CHAR_PATTERN, "");
  const collapsed = stripped.replace(WHITESPACE_RUN_PATTERN, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  if (maxChars < MIN_TRUNCATION_BUDGET) return collapsed.slice(0, maxChars);
  return `${collapsed.slice(0, maxChars - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function containsSecret(input: string): boolean {
  return detectSecret(input) !== null;
}
