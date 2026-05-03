import { type ProjectMemoryStore, promoteMarkdown } from "@/project-memory";
import type { ProjectIdentity } from "@/utils/project-id";
import { approveCandidate } from "./review";
import type { CandidateStore } from "./store";

export interface PromoteApprovedInput {
  readonly candidateStore: CandidateStore;
  readonly memoryStore: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly candidateId: string;
}

export type PromoteApprovedResult =
  | { readonly ok: true; readonly entryIds: readonly string[]; readonly candidateId: string }
  | { readonly ok: false; readonly reason: string };

export async function promoteApprovedCandidate(input: PromoteApprovedInput): Promise<PromoteApprovedResult> {
  const approval = await approveCandidate({
    store: input.candidateStore,
    projectId: input.identity.projectId,
    candidateId: input.candidateId,
  });
  if (!approval.ok) return { ok: false, reason: approval.reason };

  const promotion = await promoteMarkdown({
    store: input.memoryStore,
    identity: input.identity,
    markdown: approval.markdown,
    defaultEntityName: approval.entityName,
    sourceKind: "skill",
    pointer: approval.pointer,
  });

  if (promotion.refusedReason) return { ok: false, reason: promotion.refusedReason };
  if (promotion.accepted.length === 0) {
    const reason = promotion.rejected[0]?.reason ?? "no entries accepted";
    return { ok: false, reason };
  }

  await input.candidateStore.deleteCandidate(input.identity.projectId, input.candidateId);
  return {
    ok: true,
    candidateId: input.candidateId,
    entryIds: promotion.accepted.map((candidate) => candidate.entryId),
  };
}
