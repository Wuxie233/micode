import { extractErrorMessage } from "@/utils/errors";
import {
  BLOCKED_MARKERS,
  containsAnyMarker,
  matchesAnyPattern,
  TASK_ERROR_MARKERS,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_PATTERNS,
} from "./classify-tokens";

export const INTERNAL_CLASSES = {
  SUCCESS: "success",
  TASK_ERROR: "task_error",
  BLOCKED: "blocked",
  HARD_FAILURE: "hard_failure",
  TRANSIENT: "transient",
} as const;

export type InternalClass = (typeof INTERNAL_CLASSES)[keyof typeof INTERNAL_CLASSES];

export interface ClassifyInput {
  readonly thrown?: unknown;
  readonly httpStatus?: number | null;
  readonly assistantText?: string | null;
}

const EMPTY_RESPONSE_REASON = "empty response";
const SUCCESS_REASON = "assistant output present";
const ASSISTANT_MARKER_REASON = "assistant marker";
const HTTP_STATUS_REASON = "transient HTTP status";

function hasThrown(thrown: unknown): boolean {
  return thrown !== null && thrown !== undefined;
}

function normalizeAssistantText(input: ClassifyInput): string {
  return input.assistantText?.trim() ?? "";
}

function isTransientStatus(status: number | null | undefined): status is number {
  if (status === null || status === undefined) {
    return false;
  }
  return TRANSIENT_HTTP_STATUSES.includes(status);
}

function findMarker(value: string, markers: readonly string[]): string | null {
  if (!containsAnyMarker(value, markers)) {
    return null;
  }
  return markers.find((marker) => value.includes(marker)) ?? null;
}

export function classifySpawnError(input: ClassifyInput): { readonly class: InternalClass; readonly reason: string } {
  const assistantText = normalizeAssistantText(input);
  const thrown = hasThrown(input.thrown);
  const message = thrown ? extractErrorMessage(input.thrown) : "";

  if (thrown && matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: message };
  }

  if (isTransientStatus(input.httpStatus)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: `${HTTP_STATUS_REASON} ${input.httpStatus}` };
  }

  const blocked = findMarker(assistantText, BLOCKED_MARKERS);
  if (blocked !== null) {
    return { class: INTERNAL_CLASSES.BLOCKED, reason: `${ASSISTANT_MARKER_REASON} ${blocked}` };
  }

  const taskError = findMarker(assistantText, TASK_ERROR_MARKERS);
  if (taskError !== null) {
    return { class: INTERNAL_CLASSES.TASK_ERROR, reason: `${ASSISTANT_MARKER_REASON} ${taskError}` };
  }

  if (thrown && assistantText.length === 0) {
    return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: message };
  }

  if (assistantText.length > 0) {
    return { class: INTERNAL_CLASSES.SUCCESS, reason: SUCCESS_REASON };
  }

  return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: EMPTY_RESPONSE_REASON };
}
