import type { DedupeStore } from "./dedupe";
import type { NotificationContext, NotificationStatus, NotificationTarget } from "./types";

export interface PolicyConfig {
  readonly enabled: boolean;
  readonly qqUserId: string;
  readonly qqGroupId: string | null;
  readonly maxSummaryChars: number;
  readonly dedupeTtlMs: number;
  readonly dedupeMaxEntries: number;
}

export interface PolicyEvaluation {
  readonly status: NotificationStatus;
  readonly issueNumber?: number;
  readonly sessionId?: string;
}

export type PolicyDecision =
  | { readonly kind: "disabled" }
  | { readonly kind: "suppress"; readonly key: string }
  | { readonly kind: "notify"; readonly key: string; readonly target: NotificationTarget };

export interface Policy {
  readonly evaluate: (input: PolicyEvaluation) => PolicyDecision;
  readonly commit: (input: PolicyEvaluation) => void;
  readonly buildKey: (input: PolicyEvaluation) => string;
  readonly buildTarget: () => NotificationTarget;
}

export interface PolicyInput {
  readonly config: PolicyConfig;
  readonly dedupe: DedupeStore;
}

const ANONYMOUS_OWNER = "anonymous";

const buildKey = (input: PolicyEvaluation): string => {
  if (input.issueNumber !== undefined) return `lifecycle:${input.issueNumber}:${input.status}`;
  if (input.sessionId !== undefined) return `session:${input.sessionId}:${input.status}`;
  return `${ANONYMOUS_OWNER}:${input.status}:${Date.now()}`;
};

const buildTarget = (config: PolicyConfig): NotificationTarget => {
  if (config.qqGroupId !== null) return { kind: "group", groupId: config.qqGroupId };
  return { kind: "private", userId: config.qqUserId };
};

export function createPolicy(input: PolicyInput): Policy {
  const evaluate = (params: PolicyEvaluation): PolicyDecision => {
    if (!input.config.enabled) return { kind: "disabled" };
    const key = buildKey(params);
    if (input.dedupe.shouldSuppress(key, params.status)) return { kind: "suppress", key };
    return { kind: "notify", key, target: buildTarget(input.config) };
  };

  const commit = (params: PolicyEvaluation): void => {
    input.dedupe.record(buildKey(params), params.status);
  };

  return {
    evaluate,
    commit,
    buildKey,
    buildTarget: () => buildTarget(input.config),
  };
}

export type { NotificationContext };
