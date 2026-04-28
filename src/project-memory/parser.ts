import type { EntryType, SourceKind } from "./types";

const SECTION_PATTERNS: ReadonlyArray<{ readonly entryType: EntryType; readonly headers: readonly RegExp[] }> = [
  { entryType: "decision", headers: [/^##\s+Decisions?\b/im, /^##\s+Key Decisions\b/im] },
  { entryType: "risk", headers: [/^##\s+Risks?\b/im] },
  { entryType: "lesson", headers: [/^##\s+Lessons?(?:\s+Learned)?\b/im] },
  { entryType: "open_question", headers: [/^##\s+Open Questions?\b/im, /^##\s+Follow-?ups?\b/im] },
];

const BULLET_PATTERN = /^\s*[-*+]\s+(.+?)\s*$/gm;
const NEXT_SECTION_PATTERN = /^##\s+/m;
const TITLE_MAX_CHARS = 96;
const NOTE_SUMMARY_MAX_CHARS = 1000;

export interface PromotionInput {
  readonly markdown: string;
  readonly defaultEntityName: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromotionCandidate {
  readonly entityName: string;
  readonly entryType: EntryType;
  readonly title: string;
  readonly summary: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromotionExtraction {
  readonly candidates: readonly PromotionCandidate[];
}

function deriveTitle(summary: string): string {
  const firstLine = summary.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length <= TITLE_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

function extractSection(markdown: string, headerPattern: RegExp): string | null {
  const match = headerPattern.exec(markdown);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = NEXT_SECTION_PATTERN.exec(rest);
  return next ? rest.slice(0, next.index).trim() : rest.trim();
}

function extractBullets(section: string): readonly string[] {
  const bullets: string[] = [];
  const pattern = new RegExp(BULLET_PATTERN.source, BULLET_PATTERN.flags);
  let match = pattern.exec(section);

  while (match !== null) {
    bullets.push(match[1].trim());
    match = pattern.exec(section);
  }

  return bullets;
}

function createCandidate(input: PromotionInput, entryType: EntryType, summary: string): PromotionCandidate {
  return {
    entityName: input.defaultEntityName,
    entryType,
    title: deriveTitle(summary),
    summary,
    sourceKind: input.sourceKind,
    pointer: input.pointer,
  };
}

function extractSectionCandidates(
  input: PromotionInput,
  entryType: EntryType,
  headers: readonly RegExp[],
): readonly PromotionCandidate[] {
  return headers.flatMap((header) => {
    const section = extractSection(input.markdown, header);
    if (!section) return [];
    return extractBullets(section).map((summary) => createCandidate(input, entryType, summary));
  });
}

function extractFallbackCandidate(input: PromotionInput): PromotionCandidate | null {
  const summary = input.markdown.trim().slice(0, NOTE_SUMMARY_MAX_CHARS);
  if (summary.length === 0) return null;
  return createCandidate(input, "note", summary);
}

export function extractCandidates(input: PromotionInput): PromotionExtraction {
  const candidates = SECTION_PATTERNS.flatMap(({ entryType, headers }) =>
    extractSectionCandidates(input, entryType, headers),
  );
  if (candidates.length > 0) return { candidates };

  const fallback = extractFallbackCandidate(input);
  return { candidates: fallback === null ? [] : [fallback] };
}
