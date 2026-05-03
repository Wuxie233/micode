import type { GateInput, GateResult } from "./types";

const PATTERNS: readonly RegExp[] = [
  /\bskill[ _-]?(?:evolution|autopilot)\b/i,
  /\bfeatures\.\s*skill[\w]*\b/i,
  /\bdisable\s+skill\b/i,
  /\bskip\s+skill\s+capture\b/i,
];

const REJECTION_REASON = "self-reference to autopilot";

export function selfReferenceGate(input: GateInput): GateResult {
  const fields = [input.description, input.trigger, input.body, ...input.steps];
  for (const field of fields) {
    if (PATTERNS.some((pattern) => pattern.test(field))) {
      return { ok: false, reason: REJECTION_REASON };
    }
  }

  return { ok: true };
}
