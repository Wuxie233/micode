export const SPAWN_OUTCOMES = {
  SUCCESS: "success",
  TASK_ERROR: "task_error",
  BLOCKED: "blocked",
  HARD_FAILURE: "hard_failure",
} as const;

export type SpawnOutcome = (typeof SPAWN_OUTCOMES)[keyof typeof SPAWN_OUTCOMES];

export interface SpawnSuccess {
  readonly outcome: typeof SPAWN_OUTCOMES.SUCCESS;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly output: string;
}

export interface SpawnPreserved {
  readonly outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly sessionId: string;
  readonly output: string;
  readonly resumeCount: number;
}

export interface SpawnHardFailure {
  readonly outcome: typeof SPAWN_OUTCOMES.HARD_FAILURE;
  readonly description: string;
  readonly agent: string;
  readonly elapsedMs: number;
  readonly error: string;
}

export type SpawnResult = SpawnSuccess | SpawnPreserved | SpawnHardFailure;

export interface ResumeSubagentInput {
  readonly session_id: string;
  readonly hint?: string;
}

export interface ResumeSubagentResult {
  readonly outcome: SpawnOutcome;
  readonly sessionId: string | null;
  readonly resumeCount: number;
  readonly output: string;
}
