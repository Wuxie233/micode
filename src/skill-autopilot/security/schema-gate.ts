import { parseSkillFrontmatter } from "@/skill-autopilot/schema";
import type { GateInput, GateResult } from "./types";

export function schemaGate(input: GateInput): GateResult {
  const fm = parseSkillFrontmatter(input.frontmatter);
  if (!fm.ok) return { ok: false, reason: `schema: ${fm.reason}` };
  return { ok: true };
}
