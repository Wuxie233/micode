import type { GateInput, GateResult } from "./types";

const DESTRUCTIVE: readonly RegExp[] = [
  /^\s*rm\s+(-[rRf]+\s)/i,
  /^\s*git\s+push\s+(?!.*--force-with-lease).*--force\b/i,
  /^\s*DROP\s+TABLE\b/i,
  /^\s*mkfs\./i,
  /^\s*shred\b/i,
  />\s*\/dev\//,
];

const REASON_PREVIEW_LENGTH = 40;

export function destructiveGate(input: GateInput): GateResult {
  for (const step of input.steps) {
    if (DESTRUCTIVE.some((re) => re.test(step))) {
      return { ok: false, reason: `destructive command: ${step.slice(0, REASON_PREVIEW_LENGTH)}` };
    }
  }
  return { ok: true };
}
