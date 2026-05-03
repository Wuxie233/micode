export interface CurrentSnapshot {
  readonly frontmatter: Record<string, unknown>;
}

export interface TombstoneSnapshot {
  readonly contentHashes: readonly string[];
}

export interface SovereigntyInput {
  readonly tombstone: TombstoneSnapshot | null;
  readonly current: CurrentSnapshot | null;
  readonly candidateHash: string;
}

export type SovereigntyDecision = { readonly proceed: true } | { readonly proceed: false; readonly reason: string };

const PROCEED: SovereigntyDecision = { proceed: true };

export function decideSovereignty(input: SovereigntyInput): SovereigntyDecision {
  if (input.tombstone?.contentHashes.includes(input.candidateHash)) {
    return { proceed: false, reason: "tombstone matches candidate content" };
  }
  if (!input.current) return PROCEED;
  const fm = input.current.frontmatter;
  if (fm["x-micode-frozen"] === true) return { proceed: false, reason: "x-micode-frozen" };
  if (fm["x-micode-managed"] !== true) return { proceed: false, reason: "missing x-micode-managed marker" };
  if (typeof fm["x-micode-imported-from"] === "string" && fm["x-micode-local-overrides"] !== true) {
    return { proceed: false, reason: "imported-from without local-overrides" };
  }
  return PROCEED;
}
