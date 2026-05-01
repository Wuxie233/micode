import { extractErrorMessage } from "@/utils/errors";
import {
  BLOCKED_MARKERS,
  matchesAnyPattern,
  REVIEW_DECISION_MARKERS,
  TASK_ERROR_MARKERS,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_PATTERNS,
} from "./classify-tokens";
import { classifyMarker, MARKER_CONFIDENCE } from "./marker-confidence";

export const INTERNAL_CLASSES = {
  SUCCESS: "success",
  TASK_ERROR: "task_error",
  BLOCKED: "blocked",
  HARD_FAILURE: "hard_failure",
  TRANSIENT: "transient",
  NEEDS_VERIFICATION: "needs_verification",
  REVIEW_CHANGES_REQUESTED: "review_changes_requested",
} as const;

export type InternalClass = (typeof INTERNAL_CLASSES)[keyof typeof INTERNAL_CLASSES];

export type AmbiguousKind = typeof INTERNAL_CLASSES.TASK_ERROR | typeof INTERNAL_CLASSES.BLOCKED;

export interface ClassifyInput {
  readonly thrown?: unknown;
  readonly httpStatus?: number | null;
  readonly assistantText?: string | null;
  readonly agent?: string | null;
}

export interface ClassifyResult {
  readonly class: InternalClass;
  readonly reason: string;
  readonly markerHit?: string;
  readonly ambiguousKind?: AmbiguousKind;
}

const REVIEWER_AGENT = "reviewer";
const SPAWN_AGENT_PREFIX = "spawn-agent.";

const EMPTY_RESPONSE_REASON = "empty response";
const SUCCESS_REASON = "assistant output present";
const FINAL_MARKER_REASON = "final-status marker";
const FINAL_REVIEW_REASON = "final review decision";
const NARRATIVE_MARKER_REASON = "narrative marker requires verification";
const HTTP_STATUS_REASON = "transient HTTP status";

function hasThrown(thrown: unknown): boolean {
  return thrown !== null && thrown !== undefined;
}

function normalizeAssistantText(input: ClassifyInput): string {
  return input.assistantText?.trim() ?? "";
}

function normalizeAgent(agent: string | null | undefined): string {
  if (typeof agent !== "string") return "";
  const trimmed = agent.trim().toLowerCase();
  return trimmed.startsWith(SPAWN_AGENT_PREFIX) ? trimmed.slice(SPAWN_AGENT_PREFIX.length) : trimmed;
}

function isReviewerAgent(agent: string | null | undefined): boolean {
  return normalizeAgent(agent) === REVIEWER_AGENT;
}

function isTransientStatus(status: number | null | undefined): status is number {
  if (status === null || status === undefined) return false;
  return TRANSIENT_HTTP_STATUSES.includes(status);
}

function transientFailure(input: ClassifyInput, thrown: boolean, message: string): ClassifyResult | null {
  if (thrown && matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: message };
  }
  if (isTransientStatus(input.httpStatus)) {
    return { class: INTERNAL_CLASSES.TRANSIENT, reason: `${HTTP_STATUS_REASON} ${input.httpStatus}` };
  }
  return null;
}

function reviewFinalMarker(text: string, isReviewer: boolean): ClassifyResult | null {
  const result = classifyMarker(text, REVIEW_DECISION_MARKERS);
  if (result.confidence !== MARKER_CONFIDENCE.FINAL || result.marker === null) return null;
  if (isReviewer) {
    return {
      class: INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED,
      reason: `${FINAL_REVIEW_REASON} ${result.marker}`,
      markerHit: result.marker,
    };
  }
  return {
    class: INTERNAL_CLASSES.TASK_ERROR,
    reason: `${FINAL_MARKER_REASON} ${result.marker}`,
    markerHit: result.marker,
  };
}

function executionFinalMarker(text: string): ClassifyResult | null {
  const blocked = classifyMarker(text, BLOCKED_MARKERS);
  if (blocked.confidence === MARKER_CONFIDENCE.FINAL && blocked.marker !== null) {
    return {
      class: INTERNAL_CLASSES.BLOCKED,
      reason: `${FINAL_MARKER_REASON} ${blocked.marker}`,
      markerHit: blocked.marker,
    };
  }
  const taskError = classifyMarker(text, TASK_ERROR_MARKERS);
  if (taskError.confidence === MARKER_CONFIDENCE.FINAL && taskError.marker !== null) {
    return {
      class: INTERNAL_CLASSES.TASK_ERROR,
      reason: `${FINAL_MARKER_REASON} ${taskError.marker}`,
      markerHit: taskError.marker,
    };
  }
  return null;
}

function narrativeResult(marker: string, kind: AmbiguousKind): ClassifyResult {
  return {
    class: INTERNAL_CLASSES.NEEDS_VERIFICATION,
    reason: `${NARRATIVE_MARKER_REASON} ${marker}`,
    markerHit: marker,
    ambiguousKind: kind,
  };
}

function narrativeForKind(text: string, markers: readonly string[], kind: AmbiguousKind): ClassifyResult | null {
  const result = classifyMarker(text, markers);
  if (result.confidence !== MARKER_CONFIDENCE.NARRATIVE || result.marker === null) return null;
  return narrativeResult(result.marker, kind);
}

function narrativeMarker(text: string): ClassifyResult | null {
  const blocked = narrativeForKind(text, BLOCKED_MARKERS, INTERNAL_CLASSES.BLOCKED);
  if (blocked !== null) return blocked;

  const taskError = narrativeForKind(text, TASK_ERROR_MARKERS, INTERNAL_CLASSES.TASK_ERROR);
  if (taskError !== null) return taskError;

  return narrativeForKind(text, REVIEW_DECISION_MARKERS, INTERNAL_CLASSES.TASK_ERROR);
}

function emptyFailure(text: string, thrown: boolean, message: string): ClassifyResult | null {
  if (thrown && text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: message };
  if (text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: EMPTY_RESPONSE_REASON };
  return null;
}

export function classifySpawnError(input: ClassifyInput): ClassifyResult {
  const assistantText = normalizeAssistantText(input);
  const thrown = hasThrown(input.thrown);
  const message = thrown ? extractErrorMessage(input.thrown) : "";

  const transient = transientFailure(input, thrown, message);
  if (transient !== null) return transient;

  const isReviewer = isReviewerAgent(input.agent);

  const review = reviewFinalMarker(assistantText, isReviewer);
  if (review !== null) return review;

  const execution = executionFinalMarker(assistantText);
  if (execution !== null) return execution;

  const empty = emptyFailure(assistantText, thrown, message);
  if (empty !== null) return empty;

  const narrative = narrativeMarker(assistantText);
  if (narrative !== null) return narrative;

  return { class: INTERNAL_CLASSES.SUCCESS, reason: SUCCESS_REASON };
}
