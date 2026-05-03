import { byteLength } from "@/skill-autopilot/byte-budget";
import { config } from "@/utils/config";
import type { GateInput, GateResult } from "./types";

export interface AgentskillsContext {
  readonly dirname: string;
}

export function agentskillsGate(input: GateInput, ctx: AgentskillsContext): GateResult {
  if (!config.skillAutopilot.nameRegex.test(input.name)) return { ok: false, reason: "agentskills: name regex" };
  if (input.name !== ctx.dirname) return { ok: false, reason: `agentskills: name != basename(dir)` };
  if (byteLength(input.description) > config.skillAutopilot.descriptionMaxBytes) {
    return { ok: false, reason: "agentskills: description byte cap" };
  }
  if ("scripts" in input.frontmatter) return { ok: false, reason: "agentskills: scripts: field forbidden" };
  return { ok: true };
}
