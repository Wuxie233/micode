import type { GateInput, GateResult } from "./types";

const PATTERNS: readonly RegExp[] = [
  /\bskill[ _-]?(?:evolution|autopilot)\b/i,
  /\bfeatures\.\s*skill[\w]*\b/i,
  /\bdisable\s+skill\b/i,
  /\bskip\s+skill\s+capture\b/i,
  /\b(?:lifecycle|executor|planner|brainstormer|octto)\s+(?:request|workflow|machinery|dispatch)\b/i,
  /\b(?:open|close)\s+(?:an\s+)?issue\s+for\b/i,
  /\bspawn[- ]?agent\b/i,
  /\b(?:batch|review)_completed\b/i,
  /\bworktree\s+(?:create|cleanup|merge)\b/i,
];

const REJECTION_REASON = "self-reference to autopilot or lifecycle tooling";

export function selfReferenceGate(input: GateInput): GateResult {
  const fields = [input.description, input.trigger, input.body, ...input.steps];
  for (const field of fields) {
    if (PATTERNS.some((pattern) => pattern.test(field))) {
      return { ok: false, reason: REJECTION_REASON };
    }
  }

  return { ok: true };
}
