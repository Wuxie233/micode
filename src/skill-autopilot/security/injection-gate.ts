import type { GateInput, GateResult } from "./types";

const PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:prior|previous|all)\s+instructions?\b/i,
  /\bdisregard\s+(?:prior|previous|all)\b/i,
  /\byou\s+are\s+now\s+a\b/i,
  /(^|\W)system\s*:\s*\w+/i,
  /<\/?\s*system\b/i,
  /\[\s*INST\s*\]/i,
];

function scan(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}

export function injectionGate(input: GateInput): GateResult {
  const fields: string[] = [input.description, input.trigger, input.body, ...input.steps];
  for (const v of Object.values(input.frontmatter)) {
    if (typeof v === "string") fields.push(v);
  }
  for (const f of fields) {
    if (scan(f)) return { ok: false, reason: "prompt injection pattern" };
  }
  return { ok: true };
}
