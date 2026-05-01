import {
  SPAWN_OUTCOMES,
  type SpawnHardFailure,
  type SpawnPreserved,
  type SpawnResult,
  type SpawnReviewChanges,
  type SpawnSuccess,
} from "./types";

const MS_PER_SECOND = 1000;
const SNIPPET_LIMIT = 96;
const SNIPPET_OMISSION = "...";
const EMPTY_OUTPUT = "_No spawn-agent results._";
const MISSING_SESSION = "-";
const SECTION_DIVIDER = "\n\n---\n\n";
const TABLE_HEADER = "| Description | Agent | Outcome | Elapsed | SessionID | Output snippet |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- | --- | --- |";

function assertNever(result: never): never {
  throw new Error(`Unexpected spawn result: ${JSON.stringify(result)}`);
}

function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / MS_PER_SECOND).toFixed(1)}s`;
}

function compactCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeCell(value: string): string {
  return compactCell(value).replaceAll("|", "\\|");
}

function formatSnippet(value: string): string {
  const normalized = compactCell(value);
  if (normalized.length <= SNIPPET_LIMIT) return normalized;
  return `${normalized.slice(0, SNIPPET_LIMIT - SNIPPET_OMISSION.length)}${SNIPPET_OMISSION}`;
}

function getSessionId(result: SpawnResult): string {
  if (result.outcome === SPAWN_OUTCOMES.TASK_ERROR) return result.sessionId;
  if (result.outcome === SPAWN_OUTCOMES.BLOCKED) return result.sessionId;
  return MISSING_SESSION;
}

function getOutput(result: SpawnResult): string {
  if (result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) return result.error;
  return result.output;
}

function formatRow(result: SpawnResult): string {
  const cells = [
    result.description,
    result.agent,
    result.outcome,
    formatElapsed(result.elapsedMs),
    getSessionId(result),
    formatSnippet(getOutput(result)),
  ];
  return `| ${cells.map(escapeCell).join(" | ")} |`;
}

function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function appendDiagnostics(lines: string[], result: SpawnResult): string[] {
  if (!result.diagnostics || result.diagnostics.length === 0) return lines;
  lines.push("", `**Diagnostics**: ${result.diagnostics}`);
  return lines;
}

function formatSuccess(result: SpawnSuccess): string {
  return joinLines(
    appendDiagnostics(
      [
        `## ${result.description} (${formatElapsed(result.elapsedMs)})`,
        "",
        `**Agent**: ${result.agent}`,
        "",
        "### Result",
        "",
        result.output,
      ],
      result,
    ),
  );
}

function formatPreserved(result: SpawnPreserved): string {
  return joinLines(
    appendDiagnostics(
      [
        `## ${result.description} (${formatElapsed(result.elapsedMs)})`,
        "",
        `**Agent**: ${result.agent}`,
        `**Outcome**: ${result.outcome}`,
        `**SessionID**: ${result.sessionId}`,
        `**Resume count**: ${result.resumeCount}`,
        "",
        "### Result",
        "",
        result.output,
      ],
      result,
    ),
  );
}

function formatHardFailure(result: SpawnHardFailure): string {
  return joinLines(
    appendDiagnostics(
      [
        `## ${result.description} (${formatElapsed(result.elapsedMs)})`,
        "",
        `**Agent**: ${result.agent}`,
        `**Outcome**: ${result.outcome}`,
        "",
        "### Error",
        "",
        result.error,
      ],
      result,
    ),
  );
}

function formatReviewChanges(result: SpawnReviewChanges): string {
  return joinLines(
    appendDiagnostics(
      [
        `## ${result.description} (${formatElapsed(result.elapsedMs)})`,
        "",
        `**Agent**: ${result.agent}`,
        `**Outcome**: ${result.outcome}`,
        "",
        "### Review",
        "",
        result.output,
      ],
      result,
    ),
  );
}

function formatSection(result: SpawnResult): string {
  switch (result.outcome) {
    case SPAWN_OUTCOMES.SUCCESS:
      return formatSuccess(result);
    case SPAWN_OUTCOMES.TASK_ERROR:
    case SPAWN_OUTCOMES.BLOCKED:
      return formatPreserved(result);
    case SPAWN_OUTCOMES.HARD_FAILURE:
      return formatHardFailure(result);
    case SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED:
      return formatReviewChanges(result);
    default:
      return assertNever(result);
  }
}

function formatMultiple(results: readonly SpawnResult[]): string {
  const table = [TABLE_HEADER, TABLE_SEPARATOR, ...results.map(formatRow)].join("\n");
  const sections = results.map(formatSection).join(SECTION_DIVIDER);
  return `${table}\n\n${sections}`;
}

export function formatSpawnResults(results: readonly SpawnResult[]): string {
  const first = results[0];
  if (!first) return EMPTY_OUTPUT;
  if (results.length === 1) return formatSection(first);
  return formatMultiple(results);
}
