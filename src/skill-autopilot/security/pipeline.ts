import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { type AgentskillsContext, agentskillsGate } from "./agentskills-gate";
import { codeVerbatimGate } from "./code-verbatim-gate";
import { conflictMarkerGate } from "./conflict-marker-gate";
import { destructiveGate } from "./destructive-gate";
import { injectionGate } from "./injection-gate";
import { lengthGate } from "./length-gate";
import { piiGate } from "./pii-gate";
import { schemaGate } from "./schema-gate";
import { sanitizeCandidateInput } from "./secret-gate";
import { selfReferenceGate } from "./self-reference-gate";
import type { GateInput, GateResult } from "./types";

export function runSecurityPipeline(input: GateInput, ctx: AgentskillsContext): GateResult {
  const sanitized = sanitizeCandidateInput({ trigger: input.trigger, steps: input.steps });
  if (!sanitized.ok) return { ok: false, reason: `secret: ${sanitized.reason}` };
  const gates: ReadonlyArray<() => GateResult> = [
    () => schemaGate(input),
    () => agentskillsGate(input, ctx),
    () => piiGate(input),
    () => injectionGate(input),
    () => destructiveGate(input),
    () => selfReferenceGate(input),
    () => codeVerbatimGate(input),
    () => conflictMarkerGate(input),
    () => lengthGate(input),
  ];
  for (const g of gates) {
    const r = g();
    if (!r.ok) return r;
  }
  return { ok: true };
}

export interface RejectionRecord {
  readonly dedupeKey: string;
  readonly reason: string;
  readonly at: number;
}

export function recordRejection(journalPath: string, record: RejectionRecord): void {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${JSON.stringify(record)}\n`);
}

export function hasRejection(journalPath: string, dedupeKey: string): boolean {
  if (!existsSync(journalPath)) return false;
  const text = readFileSync(journalPath, "utf8");
  return text.split("\n").some((line) => {
    if (!line) return false;
    try {
      const parsed = JSON.parse(line) as RejectionRecord;
      return parsed.dedupeKey === dedupeKey;
    } catch {
      // intentional: malformed journal lines do not block writes
      return false;
    }
  });
}
