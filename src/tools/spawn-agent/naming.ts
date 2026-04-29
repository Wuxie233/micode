import { buildTitle, TITLE_STATUS, type TitleStatus } from "@/utils/conversation-title/format";

import { agentRoleLabel } from "./agent-roles";
import { SPAWN_OUTCOMES, type SpawnOutcome } from "./types";

const DEFAULT_MAX_LENGTH = 50;
const RUNNING_STATUS: TitleStatus = TITLE_STATUS.EXECUTING;

export interface SpawnRunningTitleInput {
  readonly agent: string;
  readonly description: string;
}

export interface SpawnCompletionTitleInput {
  readonly agent: string;
  readonly description: string;
  readonly outcome: SpawnOutcome;
}

function pickSummary(input: SpawnRunningTitleInput): string {
  const trimmed = input.description.trim();
  if (trimmed.length > 0) return trimmed;

  return agentRoleLabel(input.agent);
}

function outcomeToStatus(outcome: SpawnOutcome): TitleStatus {
  switch (outcome) {
    case SPAWN_OUTCOMES.SUCCESS:
      return TITLE_STATUS.DONE;
    case SPAWN_OUTCOMES.BLOCKED:
      return TITLE_STATUS.BLOCKED;
    case SPAWN_OUTCOMES.TASK_ERROR:
    case SPAWN_OUTCOMES.HARD_FAILURE:
      return TITLE_STATUS.FAILED;
  }
}

export function buildSpawnRunningTitle(input: SpawnRunningTitleInput, maxLength: number = DEFAULT_MAX_LENGTH): string {
  return buildTitle({ status: RUNNING_STATUS, summary: pickSummary(input) }, maxLength);
}

export function buildSpawnCompletionTitle(
  input: SpawnCompletionTitleInput,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  return buildTitle({ status: outcomeToStatus(input.outcome), summary: pickSummary(input) }, maxLength);
}
