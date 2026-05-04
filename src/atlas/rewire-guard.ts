export interface RewireInput {
  readonly target: string;
  readonly humanEdited: boolean;
  readonly runsSinceEdit: number;
  readonly windowSize: number;
}

export interface RewireDecision {
  readonly action: "rewire" | "challenge";
  readonly reason: string;
}

export function decideRewireOrChallenge(input: RewireInput): RewireDecision {
  if (!input.humanEdited) return { action: "rewire", reason: "no human edit detected" };
  if (input.runsSinceEdit >= input.windowSize) return { action: "rewire", reason: "outside recent-edit window" };
  return { action: "challenge", reason: "recently human-edited; rewire would orphan user input" };
}
