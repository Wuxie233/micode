import type { LookupHit } from "@/project-memory";

const ELLIPSIS = "…";
const BLOCK_OPEN = "<procedure-context>";
const BLOCK_CLOSE = "</procedure-context>";
const NEWLINE = "\n";
const WHITESPACE_RUN = /\s+/g;
const EMPTY_COUNT = 0;
const START_INDEX = 0;

export interface InjectPlanInput {
  readonly enabled: boolean;
  readonly maxInjectedProcedures: number;
  readonly injectionCharBudget: number;
  readonly snippetMaxChars: number;
  readonly hits: readonly LookupHit[];
}

function trim(text: string, max: number): string {
  if (max <= EMPTY_COUNT) return "";
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return text.slice(START_INDEX, max);
  return `${text.slice(START_INDEX, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

function entryLine(hit: LookupHit, snippetMaxChars: number): string {
  const rawSummary = hit.snippet.trim().length > EMPTY_COUNT ? hit.snippet : hit.entry.summary;
  const summary = rawSummary.replace(WHITESPACE_RUN, " ").trim();
  const snippet = trim(summary, snippetMaxChars);
  return `- [${hit.entry.title}] ${snippet}`;
}

function renderBlock(lines: readonly string[]): string {
  return `${NEWLINE}${BLOCK_OPEN}${NEWLINE}${lines.join(NEWLINE)}${NEWLINE}${BLOCK_CLOSE}${NEWLINE}`;
}

function fitWithinBudget(lines: readonly string[], budget: number): readonly string[] | null {
  const accepted: string[] = [];
  for (const line of lines) {
    const next = [...accepted, line];
    if (renderBlock(next).length > budget) break;
    accepted.push(line);
  }
  return accepted.length > EMPTY_COUNT ? accepted : null;
}

export function planProcedureInjection(input: InjectPlanInput): string | null {
  if (!input.enabled) return null;
  if (input.hits.length === EMPTY_COUNT) return null;

  const maxHits = Math.max(EMPTY_COUNT, input.maxInjectedProcedures);
  const limited = input.hits.slice(START_INDEX, maxHits);
  const lines = limited.map((hit) => entryLine(hit, input.snippetMaxChars));
  const accepted = fitWithinBudget(lines, input.injectionCharBudget);
  if (!accepted) return null;

  return renderBlock(accepted);
}
