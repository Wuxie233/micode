import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidates as extractMemoryCandidates, type PromotionCandidate } from "@/project-memory/parser";
import { candidateIdFor } from "./candidate-id";
import { dedupeKeyFor, sanitizeCandidateInput } from "./security/secret-gate";
import type { LedgerText } from "./sources";

const MAX_STEPS = 16;
const PROCEDURE_ENTRY_TYPE = "procedure";
const BATCH_COMPLETED = "batch_completed";
const REVIEW_COMPLETED = "review_completed";
const APPROVED_OUTCOME = "approved";
const PROCEDURE_BULLET_SEPARATOR = /\s*[;.]\s+/;
const MIN_TRIGGER_CHARS = 8;
const MAX_TRIGGER_CHARS = 240;

const SUBSTANTIVE_VERB =
  /^(?:add|modify|create|update|deploy|run|rebuild|test|debug|fix|configure|document|verify|inspect|refactor|migrate|upgrade)\b/i;
const LIFECYCLE_TOOLING_NOISE =
  /\b(?:lifecycle|issue|worktree|branch|merge|push|commit|executor|planner|brainstormer|octto|skill[- ]?autopilot|spawn[- ]?agent|review[- ]?completed|batch[- ]?completed)\b/i;

export interface RawCandidateSource {
  readonly kind: "lifecycle_journal" | "lifecycle_record" | "ledger";
  readonly pointer: string;
}

export interface RawCandidate {
  readonly id: string;
  readonly dedupeKey: string;
  readonly projectId: string;
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: readonly RawCandidateSource[];
  readonly lifecycleIssueNumber: number | null;
}

export interface MinerInput {
  readonly projectId: string;
  readonly lifecycleIssueNumber: number | null;
  readonly lifecycleRecord: string | null;
  readonly journalEvents: readonly JournalEvent[];
  readonly ledgers: readonly LedgerText[];
}

export interface MinerRejection {
  readonly trigger: string;
  readonly reason: string;
}

export interface MinerOutput {
  readonly candidates: readonly RawCandidate[];
  readonly rejected: readonly MinerRejection[];
}

interface RawDraft {
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: readonly RawCandidateSource[];
}

function isSubstantiveTrigger(trigger: string): boolean {
  if (trigger.length < MIN_TRIGGER_CHARS || trigger.length > MAX_TRIGGER_CHARS) return false;
  if (LIFECYCLE_TOOLING_NOISE.test(trigger)) return false;
  return SUBSTANTIVE_VERB.test(trigger);
}

function reviewApproved(events: readonly JournalEvent[]): boolean {
  return events.some((event) => event.kind === REVIEW_COMPLETED && event.reviewOutcome === APPROVED_OUTCOME);
}

function batchSteps(events: readonly JournalEvent[]): readonly string[] {
  return events
    .filter((event) => event.kind === BATCH_COMPLETED)
    .map((event) => event.summary)
    .slice(0, MAX_STEPS);
}

// Lifecycle remains EVIDENCE, never a verbatim trigger source. We require an
// independent substantive trigger derived from approved batch_completed steps.
// If no substantive trigger can be derived, no lifecycle draft is emitted.
function lifecycleDraft(input: MinerInput): RawDraft | null {
  if (input.lifecycleIssueNumber === null) return null;
  if (!reviewApproved(input.journalEvents)) return null;
  const steps = batchSteps(input.journalEvents);
  if (steps.length === 0) return null;
  const firstStep = steps[0] ?? "";
  if (!isSubstantiveTrigger(firstStep)) return null;
  const sources: RawCandidateSource[] = [
    { kind: "lifecycle_journal", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.journal.jsonl` },
  ];
  if (input.lifecycleRecord !== null) {
    sources.push({ kind: "lifecycle_record", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.md` });
  }
  return { trigger: firstStep, steps: steps.slice(1, MAX_STEPS), sources };
}

function splitProcedureSummary(summary: string): readonly string[] {
  return summary
    .split(PROCEDURE_BULLET_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function ledgerDraftFor(candidate: PromotionCandidate, pointer: string): RawDraft | null {
  if (candidate.entryType !== PROCEDURE_ENTRY_TYPE) return null;
  const parts = splitProcedureSummary(candidate.summary);
  if (parts.length < 2) return null;
  const [trigger, ...steps] = parts;
  if (!trigger) return null;
  if (!isSubstantiveTrigger(trigger)) return null;
  return { trigger, steps: steps.slice(0, MAX_STEPS), sources: [{ kind: "ledger", pointer }] };
}

function draftsForLedger(ledger: LedgerText): readonly RawDraft[] {
  const extracted = extractMemoryCandidates({
    markdown: ledger.text,
    defaultEntityName: "skill",
    sourceKind: "ledger",
    pointer: ledger.path,
  });
  return extracted.candidates.flatMap((candidate) => {
    const draft = ledgerDraftFor(candidate, ledger.path);
    return draft === null ? [] : [draft];
  });
}

function ledgerDrafts(input: MinerInput): readonly RawDraft[] {
  return input.ledgers.flatMap(draftsForLedger);
}

function buildCandidate(input: MinerInput, draft: RawDraft): RawCandidate | MinerRejection {
  const sanitized = sanitizeCandidateInput({ trigger: draft.trigger, steps: draft.steps });
  if (!sanitized.ok) return { trigger: draft.trigger, reason: sanitized.reason };
  const dedupeKey = dedupeKeyFor({ trigger: sanitized.value.trigger, steps: sanitized.value.steps });
  return {
    id: candidateIdFor(input.projectId, sanitized.value.trigger, sanitized.value.steps),
    dedupeKey,
    projectId: input.projectId,
    trigger: sanitized.value.trigger,
    steps: [...sanitized.value.steps],
    sources: draft.sources,
    lifecycleIssueNumber: input.lifecycleIssueNumber,
  };
}

export function extractRawCandidates(input: MinerInput): MinerOutput {
  // Ledger drafts are listed first because the corrected design ranks ledgers
  // higher than lifecycle journal events (lifecycle is evidence only).
  const drafts: RawDraft[] = [];
  drafts.push(...ledgerDrafts(input));
  const lifecycle = lifecycleDraft(input);
  if (lifecycle !== null) drafts.push(lifecycle);

  const candidates: RawCandidate[] = [];
  const rejected: MinerRejection[] = [];
  const seenIds = new Set<string>();
  for (const draft of drafts) {
    const built = buildCandidate(input, draft);
    if ("reason" in built) {
      rejected.push(built);
      continue;
    }
    if (seenIds.has(built.id)) continue;
    seenIds.add(built.id);
    candidates.push(built);
  }
  return { candidates, rejected };
}
