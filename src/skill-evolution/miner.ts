import { createHash } from "node:crypto";

import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidates as extractMemoryCandidates, type PromotionCandidate } from "@/project-memory/parser";
import type { Candidate } from "./candidate-schema";
import { dedupeKeyFor, sanitizeCandidateInput } from "./sanitize";
import type { LedgerText } from "./sources";

const ID_PREFIX = "cand_";
const ID_HASH_CHARS = 12;
const MAX_STEPS = 16;
const TRIGGER_FALLBACK = "Lifecycle workflow";
const PROCEDURE_BULLET_SEPARATOR = /\s*[;.]\s+/;

export interface MinerInput {
  readonly projectId: string;
  readonly now: number;
  readonly expiryMs: number;
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
  readonly candidates: readonly Candidate[];
  readonly rejected: readonly MinerRejection[];
}

interface RawDraft {
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: Candidate["sources"];
}

function candidateIdFor(projectId: string, trigger: string, steps: readonly string[]): string {
  const key = dedupeKeyFor({ trigger, steps });
  const payload = `${projectId}\u0000${key}`;
  return `${ID_PREFIX}${createHash("sha1").update(payload).digest("hex").slice(0, ID_HASH_CHARS)}`;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function deriveTriggerFromLifecycle(record: string | null): string {
  if (!record) return TRIGGER_FALLBACK;
  const requestMatch = /^##\s+Request\b/im.exec(record);
  if (!requestMatch) return TRIGGER_FALLBACK;
  const after = record.slice(requestMatch.index + requestMatch[0].length);
  const next = /^##\s+/m.exec(after);
  const body = next ? after.slice(0, next.index) : after;
  const candidate = firstLine(body);
  return candidate.length > 0 ? candidate : TRIGGER_FALLBACK;
}

function reviewApproved(events: readonly JournalEvent[]): boolean {
  return events.some((event) => event.kind === "review_completed" && event.reviewOutcome === "approved");
}

function batchSteps(events: readonly JournalEvent[]): readonly string[] {
  return events
    .filter((event) => event.kind === "batch_completed")
    .map((event) => event.summary)
    .slice(0, MAX_STEPS);
}

function lifecycleDraft(input: MinerInput): RawDraft | null {
  if (input.lifecycleIssueNumber === null) return null;
  if (!reviewApproved(input.journalEvents)) return null;
  const steps = batchSteps(input.journalEvents);
  if (steps.length === 0) return null;
  const trigger = deriveTriggerFromLifecycle(input.lifecycleRecord);
  const sources: Candidate["sources"] = [
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
  if (candidate.entryType !== "procedure") return null;
  const parts = splitProcedureSummary(candidate.summary);
  if (parts.length < 2) return null;
  const [trigger, ...steps] = parts;
  return {
    trigger,
    steps: steps.slice(0, MAX_STEPS),
    sources: [{ kind: "ledger", pointer }],
  };
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

function buildCandidate(input: MinerInput, draft: RawDraft): Candidate | MinerRejection {
  const sanitized = sanitizeCandidateInput({ trigger: draft.trigger, steps: draft.steps });
  if (!sanitized.ok) return { trigger: draft.trigger, reason: sanitized.reason };
  const id = candidateIdFor(input.projectId, sanitized.value.trigger, sanitized.value.steps);
  return {
    id,
    projectId: input.projectId,
    trigger: sanitized.value.trigger,
    steps: [...sanitized.value.steps],
    sources: draft.sources,
    sensitivity: "internal",
    status: "pending",
    createdAt: input.now,
    expiresAt: input.now + input.expiryMs,
    hits: 0,
  };
}

export function extractCandidatesFromSources(input: MinerInput): MinerOutput {
  const drafts: RawDraft[] = [];
  const lifecycle = lifecycleDraft(input);
  if (lifecycle) drafts.push(lifecycle);
  drafts.push(...ledgerDrafts(input));

  const candidates: Candidate[] = [];
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
