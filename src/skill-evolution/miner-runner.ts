import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { Candidate } from "./candidate-schema";
import { extractCandidatesFromSources } from "./miner";
import { dedupeKeyFor } from "./sanitize";
import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "./sources";
import type { CandidateStore } from "./store";

const LOG_SCOPE = "skill-evolution.miner-runner";
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export interface RunMinerInput {
  readonly cwd: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly now: number;
  readonly candidateStore: CandidateStore;
}

export interface RunMinerOutput {
  readonly candidatesAdded: number;
  readonly candidatesSkipped: number;
  readonly rejected: number;
}

interface StoreCounts {
  readonly candidatesAdded: number;
  readonly candidatesSkipped: number;
}

async function storeNewCandidates(input: RunMinerInput, candidates: readonly Candidate[]): Promise<StoreCounts> {
  let candidatesAdded = 0;
  let candidatesSkipped = 0;
  for (const candidate of candidates) {
    const existing = await input.candidateStore.findByDedupeKey(input.projectId, {
      trigger: candidate.trigger,
      steps: candidate.steps,
    });
    if (existing) {
      candidatesSkipped += 1;
      continue;
    }
    await input.candidateStore.upsertCandidate(candidate);
    candidatesAdded += 1;
  }
  return { candidatesAdded, candidatesSkipped };
}

export async function runMiner(input: RunMinerInput): Promise<RunMinerOutput> {
  const expiryMs = config.skillEvolution.candidateExpiryDays * MS_PER_DAY;
  let candidatesAdded = 0;
  let candidatesSkipped = 0;
  let rejected = 0;

  try {
    const [journalEvents, lifecycleRecord, ledgers] = await Promise.all([
      readJournalEvents({ cwd: input.cwd, issueNumber: input.issueNumber }),
      readLifecycleRecord({ cwd: input.cwd, issueNumber: input.issueNumber }),
      readLedgerTexts({ cwd: input.cwd }),
    ]);

    const mined = extractCandidatesFromSources({
      projectId: input.projectId,
      now: input.now,
      expiryMs,
      lifecycleIssueNumber: input.issueNumber,
      lifecycleRecord,
      journalEvents,
      ledgers,
    });
    rejected = mined.rejected.length;
    const stored = await storeNewCandidates(input, mined.candidates);
    candidatesAdded = stored.candidatesAdded;
    candidatesSkipped = stored.candidatesSkipped;
  } catch (error) {
    log.warn(LOG_SCOPE, `runMiner failed: ${extractErrorMessage(error)}`);
  }

  return { candidatesAdded, candidatesSkipped, rejected };
}

export const computeDedupeKey = dedupeKeyFor;
