import { ATLAS_COMMIT_PREFIX, ATLAS_ROOT_DIRNAME } from "./config";

const PREFIX_PATTERN = /^atlas:\s*/;

export function buildAtlasCommitMessage(summary: string): string {
  const cleaned = summary.replace(PREFIX_PATTERN, "").trim();
  return `${ATLAS_COMMIT_PREFIX} ${cleaned}`;
}

export interface StagedValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateStagedPaths(paths: readonly string[]): StagedValidation {
  if (paths.length === 0) return { ok: false, reason: "no atlas paths staged" };
  const offenders = paths.filter((path) => !path.startsWith(`${ATLAS_ROOT_DIRNAME}/`));
  if (offenders.length > 0) return { ok: false, reason: `non-atlas paths staged: ${offenders.join(", ")}` };
  return { ok: true };
}

export interface AtlasInitCommitSummaryInput {
  readonly runId: string;
}

export function buildAtlasInitCommitSummary(input: AtlasInitCommitSummaryInput): string {
  return `init vault (run ${input.runId})`;
}

export interface AtlasTranslateCommitSummaryInput {
  readonly runId: string;
  readonly targetPath: string;
}

export function buildAtlasTranslateCommitSummary(input: AtlasTranslateCommitSummaryInput): string {
  return `translate ${input.targetPath} (run ${input.runId})`;
}
