import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidates as extractMemoryCandidates, type PromotionCandidate } from "@/project-memory/parser";
import { candidateIdFor } from "./candidate-id";
import { dedupeKeyFor, sanitizeCandidateInput } from "./security/secret-gate";
import type { LedgerText } from "./sources";

const MAX_STEPS = 16;
const FIRST_LINE_LIMIT = 1;
const REQUEST_HEADING = /^##\s+Request\b/im;
const NEXT_HEADING = /^##\s+/m;
const TRIGGER_FALLBACK = "Lifecycle workflow";
const PROCEDURE_ENTRY_TYPE = "procedure";
const BATCH_COMPLETED = "batch_completed";
const REVIEW_COMPLETED = "review_completed";
const APPROVED_OUTCOME = "approved";
const PROCEDURE_BULLET_SEPARATOR = /\s*[;.]\s+/;

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

function firstLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(/\r?\n/, FIRST_LINE_LIMIT)[0]?.trim() ?? "";
}

function deriveTriggerFromLifecycle(record: string | null): string {
  if (!record) return TRIGGER_FALLBACK;
  const request = REQUEST_HEADING.exec(record);
  if (!request) return TRIGGER_FALLBACK;

  const afterRequest = record.slice(request.index + request[0].length);
  const nextHeading = NEXT_HEADING.exec(afterRequest);
  const body = nextHeading ? afterRequest.slice(0, nextHeading.index) : afterRequest;
  const trigger = firstLine(body);
  return trigger.length > 0 ? trigger : TRIGGER_FALLBACK;
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

function lifecycleDraft(input: MinerInput): RawDraft | null {
  if (input.lifecycleIssueNumber === null) return null;
  if (!reviewApproved(input.journalEvents)) return null;
  const steps = batchSteps(input.journalEvents);
  if (steps.length === 0) return null;
  const trigger = deriveTriggerFromLifecycle(input.lifecycleRecord);
  const sources: RawCandidateSource[] = [
    { kind: "lifecycle_journal", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.journal.jsonl` },
  ];
  if (input.lifecycleRecord !== null) {
    sources.push({ kind: "lifecycle_record", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.md` });
  }
  return { trigger, steps, sources };
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
  const drafts: RawDraft[] = [];
  const lifecycle = lifecycleDraft(input);
  if (lifecycle !== null) drafts.push(lifecycle);
  drafts.push(...ledgerDrafts(input));

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
