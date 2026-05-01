import { extractErrorMessage } from "@/utils/errors";
import {
  BLOCKED_MARKERS,
  matchesAnyPattern,
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
} as const;

export type InternalClass = (typeof INTERNAL_CLASSES)[keyof typeof INTERNAL_CLASSES];

export type AmbiguousKind = typeof INTERNAL_CLASSES.TASK_ERROR | typeof INTERNAL_CLASSES.BLOCKED;

export interface ClassifyInput {
  readonly thrown?: unknown;
  readonly httpStatus?: number | null;
  readonly assistantText?: string | null;
}

export interface ClassifyResult {
  readonly class: InternalClass;
  readonly reason: string;
  readonly markerHit?: string;
  readonly ambiguousKind?: AmbiguousKind;
}

interface KindMarkers {
  readonly kind: AmbiguousKind;
  readonly final: string | null;
  readonly narrative: string | null;
}

const EMPTY_RESPONSE_REASON = "empty response";
const SUCCESS_REASON = "assistant output present";
const FINAL_MARKER_REASON = "final-status marker";
const NARRATIVE_MARKER_REASON = "narrative marker requires verification";
const HTTP_STATUS_REASON = "transient HTTP status";

function hasThrown(thrown: unknown): boolean {
  return thrown !== null && thrown !== undefined;
}

function normalizeAssistantText(input: ClassifyInput): string {
  return input.assistantText?.trim() ?? "";
}

function isTransientStatus(status: number | null | undefined): status is number {
  if (status === null || status === undefined) return false;
  return TRANSIENT_HTTP_STATUSES.includes(status);
}

function classifyForKind(text: string, markers: readonly string[]): { final: string | null; narrative: string | null } {
  const result = classifyMarker(text, markers);
  if (result.confidence === MARKER_CONFIDENCE.FINAL) return { final: result.marker, narrative: null };
  if (result.confidence === MARKER_CONFIDENCE.NARRATIVE) return { final: null, narrative: result.marker };
  return { final: null, narrative: null };
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

function classifyMarkers(text: string): readonly KindMarkers[] {
  const blocked = classifyForKind(text, BLOCKED_MARKERS);
  const taskError = classifyForKind(text, TASK_ERROR_MARKERS);
  return [
    { kind: INTERNAL_CLASSES.BLOCKED, final: blocked.final, narrative: blocked.narrative },
    { kind: INTERNAL_CLASSES.TASK_ERROR, final: taskError.final, narrative: taskError.narrative },
  ];
}

function finalMarker(markers: readonly KindMarkers[]): ClassifyResult | null {
  const match = markers.find((candidate) => candidate.final !== null);
  if (match === undefined || match.final === null) return null;
  return { class: match.kind, reason: `${FINAL_MARKER_REASON} ${match.final}`, markerHit: match.final };
}

function emptyFailure(text: string, thrown: boolean, message: string): ClassifyResult | null {
  if (thrown && text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: message };
  if (text.length === 0) return { class: INTERNAL_CLASSES.HARD_FAILURE, reason: EMPTY_RESPONSE_REASON };
  return null;
}

function narrativeMarker(markers: readonly KindMarkers[]): ClassifyResult | null {
  const match = markers.find((candidate) => candidate.narrative !== null);
  if (match === undefined || match.narrative === null) return null;
  return {
    class: INTERNAL_CLASSES.NEEDS_VERIFICATION,
    reason: `${NARRATIVE_MARKER_REASON} ${match.narrative}`,
    markerHit: match.narrative,
    ambiguousKind: match.kind,
  };
}

export function classifySpawnError(input: ClassifyInput): ClassifyResult {
  const assistantText = normalizeAssistantText(input);
  const thrown = hasThrown(input.thrown);
  const message = thrown ? extractErrorMessage(input.thrown) : "";

  const transient = transientFailure(input, thrown, message);
  if (transient !== null) return transient;

  const markers = classifyMarkers(assistantText);
  const final = finalMarker(markers);
  if (final !== null) return final;

  const empty = emptyFailure(assistantText, thrown, message);
  if (empty !== null) return empty;

  const narrative = narrativeMarker(markers);
  if (narrative !== null) return narrative;

  return { class: INTERNAL_CLASSES.SUCCESS, reason: SUCCESS_REASON };
}
