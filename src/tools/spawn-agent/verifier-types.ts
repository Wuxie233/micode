export const VERIFIER_DECISIONS = {
  FINAL: "final",
  NARRATIVE: "narrative",
} as const;

export type VerifierDecision = (typeof VERIFIER_DECISIONS)[keyof typeof VERIFIER_DECISIONS];

export const VERIFIER_CONFIDENCE = {
  HIGH: "high",
  LOW: "low",
} as const;

export type VerifierConfidence = (typeof VERIFIER_CONFIDENCE)[keyof typeof VERIFIER_CONFIDENCE];

export interface VerifierResult {
  readonly decision: VerifierDecision;
  readonly confidence: VerifierConfidence;
  readonly reason: string;
}

const REASON_LIMIT = 200;
const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
const VALID_DECISIONS = new Set<string>([VERIFIER_DECISIONS.FINAL, VERIFIER_DECISIONS.NARRATIVE]);
const VALID_CONFIDENCES = new Set<string>([VERIFIER_CONFIDENCE.HIGH, VERIFIER_CONFIDENCE.LOW]);

function unwrapFenced(value: string): string {
  const match = FENCE_PATTERN.exec(value);
  return match ? match[1].trim() : value.trim();
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(unwrapFenced(raw));
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampReason(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= REASON_LIMIT ? trimmed : trimmed.slice(0, REASON_LIMIT);
}

function clampConfidence(value: unknown): VerifierConfidence {
  if (typeof value === "string" && VALID_CONFIDENCES.has(value)) return value as VerifierConfidence;
  return VERIFIER_CONFIDENCE.LOW;
}

export function parseVerifierResponse(raw: string): VerifierResult | null {
  const parsed = safeParse(raw);
  if (!isObject(parsed)) return null;
  const decisionValue = parsed.decision;
  if (typeof decisionValue !== "string" || !VALID_DECISIONS.has(decisionValue)) return null;
  return {
    decision: decisionValue as VerifierDecision,
    confidence: clampConfidence(parsed.confidence),
    reason: clampReason(parsed.reason),
  };
}
