export interface OverlapInput {
  readonly candidateTrigger: string;
  readonly existing: ReadonlyArray<{ readonly name: string; readonly trigger: string }>;
  readonly threshold: number;
  readonly supersedes: string | null;
}

const TOKEN = /[a-z0-9]+/gi;

function tokens(s: string): Set<string> {
  return new Set((s.match(TOKEN) ?? []).map((t) => t.toLowerCase()));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function detectTriggerOverlap(input: OverlapInput): string | null {
  const candidate = tokens(input.candidateTrigger);
  for (const e of input.existing) {
    if (input.supersedes === e.name) continue;
    if (jaccard(candidate, tokens(e.trigger)) >= input.threshold) return e.name;
  }
  return null;
}
