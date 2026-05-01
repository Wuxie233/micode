import { extractErrorMessage } from "@/utils/errors";

import { classifySpawnError, INTERNAL_CLASSES } from "./classify";
import { buildSpawnCompletionTitle } from "./naming";
import { getSpawnRegistryForPreservedRegistry, type PreservedRecord, type PreservedRegistry } from "./registry";
import { SPAWN_OUTCOMES } from "./types";

const REVIEWER_AGENT = "reviewer";

export interface RetitleReadInput {
  readonly sessionId: string;
}

export interface RetitleUpdateInput {
  readonly sessionId: string;
  readonly title: string;
}

export interface RetitleStaleReviewsInput {
  readonly registry: PreservedRegistry;
  readonly readOutput: (input: RetitleReadInput) => Promise<string>;
  readonly updateTitle: (input: RetitleUpdateInput) => Promise<void>;
}

export interface RetitleFailure {
  readonly sessionId: string;
  readonly error: string;
}

export interface RetitleStaleReviewsResult {
  readonly retitled: readonly string[];
  readonly skipped: readonly string[];
  readonly failures: readonly RetitleFailure[];
}

function listPreservedRecords(registry: PreservedRegistry): readonly PreservedRecord[] {
  const spawn = getSpawnRegistryForPreservedRegistry(registry);
  if (spawn === null) return [];
  return spawn.listPreserved().map((record) => ({
    sessionId: record.sessionId,
    agent: record.agent,
    description: record.description,
    outcome: record.outcome,
    preservedAt: record.preservedAt,
    resumeCount: record.resumeCount,
  }));
}

function isReviewerTaskError(record: PreservedRecord): boolean {
  return record.agent.trim().toLowerCase() === REVIEWER_AGENT && record.outcome === SPAWN_OUTCOMES.TASK_ERROR;
}

async function attemptRetitle(
  input: RetitleStaleReviewsInput,
  record: PreservedRecord,
): Promise<{ readonly outcome: "retitled" | "skipped"; readonly failure?: RetitleFailure }> {
  let output: string;
  try {
    output = await input.readOutput({ sessionId: record.sessionId });
  } catch (error) {
    return {
      outcome: "skipped",
      failure: { sessionId: record.sessionId, error: extractErrorMessage(error) },
    };
  }

  const classification = classifySpawnError({ assistantText: output, agent: record.agent });
  if (classification.class !== INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED) return { outcome: "skipped" };

  const title = buildSpawnCompletionTitle({
    agent: record.agent,
    description: record.description,
    outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
  });

  try {
    await input.updateTitle({ sessionId: record.sessionId, title });
  } catch (error) {
    return {
      outcome: "skipped",
      failure: { sessionId: record.sessionId, error: extractErrorMessage(error) },
    };
  }

  input.registry.remove(record.sessionId);
  return { outcome: "retitled" };
}

export async function retitleStaleReviewSessions(input: RetitleStaleReviewsInput): Promise<RetitleStaleReviewsResult> {
  const records = listPreservedRecords(input.registry).filter(isReviewerTaskError);
  const retitled: string[] = [];
  const skipped: string[] = [];
  const failures: RetitleFailure[] = [];

  for (const record of records) {
    const result = await attemptRetitle(input, record);
    if (result.outcome === "retitled") retitled.push(record.sessionId);
    if (result.outcome === "skipped") skipped.push(record.sessionId);
    if (result.failure) failures.push(result.failure);
  }

  return { retitled, skipped, failures };
}
