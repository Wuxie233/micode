import { byteLength } from "@/skill-autopilot/byte-budget";
import { config } from "@/utils/config";
import type { GateInput, GateResult } from "./types";

export function lengthGate(input: GateInput): GateResult {
  if (byteLength(input.body) > config.skillAutopilot.bodyMaxBytes) {
    return { ok: false, reason: "body byte cap" };
  }
  if (input.steps.length > config.skillAutopilot.maxStepsPerSkill) {
    return { ok: false, reason: `steps > ${config.skillAutopilot.maxStepsPerSkill}` };
  }
  return { ok: true };
}
