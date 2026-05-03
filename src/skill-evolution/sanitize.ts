import { createHash } from "node:crypto";

import { detectSecret } from "@/utils/secret-detect";

const WHITESPACE_RUN = /\s+/g;
const HASH_PREFIX_LENGTH = 12;
const SEPARATOR = "\u0000";

export interface RawCandidateInput {
  readonly trigger: string;
  readonly steps: readonly string[];
}

export interface SanitizedCandidateInput {
  readonly trigger: string;
  readonly steps: readonly string[];
}

export type SanitizeResult =
  | { readonly ok: true; readonly value: SanitizedCandidateInput }
  | { readonly ok: false; readonly reason: string };

function normalize(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

function checkSecret(text: string, label: string): string | null {
  const match = detectSecret(text);
  return match ? `${label} contains secret (${match.reason})` : null;
}

export function sanitizeCandidateInput(raw: RawCandidateInput): SanitizeResult {
  const trigger = normalize(raw.trigger);
  if (trigger.length === 0) return { ok: false, reason: "trigger empty after normalization" };
  const triggerSecret = checkSecret(trigger, "trigger");
  if (triggerSecret) return { ok: false, reason: triggerSecret };

  const steps: string[] = [];
  for (const [index, rawStep] of raw.steps.entries()) {
    const step = normalize(rawStep);
    if (step.length === 0) return { ok: false, reason: `step ${index} empty after normalization` };
    const stepSecret = checkSecret(step, `step ${index}`);
    if (stepSecret) return { ok: false, reason: stepSecret };
    steps.push(step);
  }

  return { ok: true, value: { trigger, steps } };
}

export function dedupeKeyFor(input: RawCandidateInput): string {
  const trigger = normalize(input.trigger);
  const steps = input.steps.map(normalize);
  const payload = [trigger, ...steps].join(SEPARATOR);
  return createHash("sha1").update(payload).digest("hex").slice(0, HASH_PREFIX_LENGTH);
}
