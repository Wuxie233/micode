export interface NodeSummary {
  readonly id: string;
  readonly sources: readonly string[];
}

export interface PlanInput {
  readonly nodes: readonly NodeSummary[];
  readonly activeSources: ReadonlySet<string>;
}

export interface SoftDeletePlan {
  readonly id: string;
  readonly reason: string;
}

export function planSoftDeletes(input: PlanInput): readonly SoftDeletePlan[] {
  const plans: SoftDeletePlan[] = [];
  for (const node of input.nodes) {
    if (node.sources.length === 0) continue;
    const allGone = node.sources.every((s) => !input.activeSources.has(s));
    if (allGone) plans.push({ id: node.id, reason: "all sources disappeared" });
  }
  return plans;
}
