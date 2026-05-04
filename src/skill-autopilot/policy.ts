import { config } from "@/utils/config";
import type { RawCandidate } from "./miner";

export interface ExistingSkillSummary {
  readonly name: string;
  readonly trigger: string;
  readonly dedupeKey: string;
}

export interface PolicyInput {
  readonly candidate: RawCandidate;
  readonly hitsByKey: Readonly<Record<string, number>>;
  readonly distinctIssuesByKey: Readonly<Record<string, ReadonlySet<number>>>;
  readonly existingSkills: readonly ExistingSkillSummary[];
  readonly writesThisLifecycle: number;
  readonly proposedSensitivity?: string;
}

export type PolicyAction = "create" | "patch" | "skip";

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly targetSkillName?: string;
  readonly reason?: string;
}

const SKIP = (reason: string): PolicyDecision => ({ action: "skip", reason });

function isAllowedSensitivity(sensitivity: string): boolean {
  return config.skillAutopilot.allowedAutoWriteSensitivities.includes(sensitivity);
}

export function decidePolicy(input: PolicyInput): PolicyDecision {
  if (input.writesThisLifecycle >= config.skillAutopilot.maxWritesPerLifecycle) {
    return SKIP("per-lifecycle write ceiling");
  }
  const sensitivity = input.proposedSensitivity ?? config.skillAutopilot.defaultSensitivity;
  if (!isAllowedSensitivity(sensitivity)) {
    return SKIP(`sensitivity '${sensitivity}' not in allow-list (public-by-default policy)`);
  }
  const hits = input.hitsByKey[input.candidate.dedupeKey] ?? 0;
  if (hits < config.skillAutopilot.recurrenceMinHits) return SKIP(`hits=${hits} < min`);
  const issues = input.distinctIssuesByKey[input.candidate.dedupeKey] ?? new Set<number>();
  if (issues.size < config.skillAutopilot.recurrenceMinDistinctIssues) {
    return SKIP(`distinct issues=${issues.size} < min`);
  }
  const existing = input.existingSkills.find((s) => s.dedupeKey === input.candidate.dedupeKey);
  if (existing) return { action: "patch", targetSkillName: existing.name };
  return { action: "create" };
}
