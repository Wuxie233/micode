import { config } from "@/utils/config";
import type { GateInput, GateResult } from "./types";

const FENCE = /```[\s\S]*?```/g;

export function codeVerbatimGate(input: GateInput): GateResult {
  const matches = input.body.match(FENCE) ?? [];
  for (const block of matches) {
    const lineCount = block.split("\n").length - 2;
    if (lineCount > config.skillAutopilot.maxFenceLines) {
      return { ok: false, reason: `fenced block exceeds ${config.skillAutopilot.maxFenceLines} lines` };
    }
  }
  return { ok: true };
}
