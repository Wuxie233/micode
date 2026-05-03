import type { GateInput, GateResult } from "./types";

const MARKERS = /^(?:<{7}|={7}|>{7})\s/m;

export function hasConflictMarkers(text: string): boolean {
  return MARKERS.test(text);
}

export function conflictMarkerGate(input: GateInput): GateResult {
  if (hasConflictMarkers(input.body)) return { ok: false, reason: "conflict markers in body" };
  return { ok: true };
}
