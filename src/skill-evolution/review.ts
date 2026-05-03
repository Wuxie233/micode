import type { Candidate } from "./candidate-schema";
import type { CandidateStore } from "./store";

export interface ApproveInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly candidateId: string;
}

export interface ApproveSuccess {
  readonly ok: true;
  readonly markdown: string;
  readonly entityName: string;
  readonly pointer: string;
  readonly candidate: Candidate;
}

export interface ApproveFailure {
  readonly ok: false;
  readonly reason: string;
}

export type ApproveResult = ApproveSuccess | ApproveFailure;

export interface RejectInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly candidateId: string;
  readonly reason: string;
}

export type RejectResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PurgeInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly now: number;
}

const POINTER_PREFIX = "skill-candidate://";
const ENTITY_PREFIX = "skill-";

function compareCreatedAt(left: Candidate, right: Candidate): number {
  return left.createdAt - right.createdAt;
}

function isPending(candidate: Candidate): boolean {
  return candidate.status === "pending";
}

function renderApprovalMarkdown(candidate: Candidate): string {
  const stepsLine = candidate.steps.map((step, index) => `${index + 1}) ${step}`).join("; ");
  const bullet = `${candidate.trigger}; ${stepsLine}`;
  return `## Procedure\n- ${bullet}\n`;
}

export async function listPending(store: CandidateStore, projectId: string): Promise<readonly Candidate[]> {
  const candidates = await store.listCandidates(projectId);
  return candidates.filter(isPending).slice().sort(compareCreatedAt);
}

export async function approveCandidate(input: ApproveInput): Promise<ApproveResult> {
  const candidate = await input.store.loadCandidate(input.projectId, input.candidateId);
  if (!candidate) return { ok: false, reason: `candidate not found: ${input.candidateId}` };
  return {
    ok: true,
    markdown: renderApprovalMarkdown(candidate),
    entityName: `${ENTITY_PREFIX}${candidate.id}`,
    pointer: `${POINTER_PREFIX}${candidate.id}`,
    candidate,
  };
}

export async function rejectCandidate(input: RejectInput): Promise<RejectResult> {
  const candidate = await input.store.loadCandidate(input.projectId, input.candidateId);
  if (!candidate) return { ok: false, reason: `candidate not found: ${input.candidateId}` };
  await input.store.deleteCandidate(input.projectId, input.candidateId);
  return { ok: true };
}

export async function purgeExpiredCandidates(input: PurgeInput): Promise<number> {
  return input.store.purgeExpired(input.projectId, input.now);
}
