import type { EntryType, SourceKind } from "./types";

const SECTION_PATTERNS: ReadonlyArray<{ readonly entryType: EntryType; readonly headers: readonly RegExp[] }> = [
  { entryType: "decision", headers: [/^##\s+Decisions?\b/im, /^##\s+Key Decisions\b/im] },
  { entryType: "risk", headers: [/^##\s+Risks?\b/im] },
  { entryType: "lesson", headers: [/^##\s+Lessons?(?:\s+Learned)?\b/im] },
  { entryType: "open_question", headers: [/^##\s+Open Questions?\b/im, /^##\s+Follow-?ups?\b/im] },
  { entryType: "procedure", headers: [/^##\s+Procedures?\b/im] },
];

const LIFECYCLE_REQUEST_HEADER = /^##\s+Request\b/im;
const LIFECYCLE_GOALS_HEADER = /^##\s+Goals?\b/im;
const LIFECYCLE_CONSTRAINTS_HEADER = /^##\s+Constraints?\b/im;
const LIFECYCLE_BULLET_HEADERS: readonly RegExp[] = [LIFECYCLE_GOALS_HEADER, LIFECYCLE_CONSTRAINTS_HEADER];
const BULLET_PATTERN = /^\s*[-*+]\s+(.+?)\s*$/gm;
const NEXT_SECTION_PATTERN = /^##\s+/m;
const HEADING_LINE_PATTERN = /^#+\s/;
const TITLE_MAX_CHARS = 96;
const NOTE_SUMMARY_MAX_CHARS = 1000;
const ELLIPSIS = "…";

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

function capTitle(text: string): string {
  if (text.length <= TITLE_MAX_CHARS) return text;
  return `${text.slice(0, TITLE_MAX_CHARS - 1)}${ELLIPSIS}`;
}

function firstMeaningfulLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (HEADING_LINE_PATTERN.test(line)) continue;
    return line;
  }
  return "";
}

function deriveTitleFromSummary(summary: string): string {
  const candidate = firstMeaningfulLine(summary);
  if (candidate.length > 0) return capTitle(candidate);
  return capTitle(summary.split("\n", 1)[0]?.trim() ?? "");
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
    title: deriveTitleFromSummary(summary),
    summary,
    sourceKind: input.sourceKind,
    pointer: input.pointer,
  };
}

function extractStructuredCandidates(input: PromotionInput): readonly PromotionCandidate[] {
  return SECTION_PATTERNS.flatMap(({ entryType, headers }) =>
    headers.flatMap((header) => {
      const section = extractSection(input.markdown, header);
      if (!section) return [];
      return extractBullets(section).map((summary) => createCandidate(input, entryType, summary));
    }),
  );
}

function extractRequestNote(input: PromotionInput): PromotionCandidate | null {
  const section = extractSection(input.markdown, LIFECYCLE_REQUEST_HEADER);
  if (!section) return null;
  const summary = section.slice(0, NOTE_SUMMARY_MAX_CHARS);
  if (summary.length === 0) return null;
  return createCandidate(input, "note", summary);
}

function extractBulletNotes(input: PromotionInput, header: RegExp): readonly PromotionCandidate[] {
  const section = extractSection(input.markdown, header);
  if (!section) return [];
  return extractBullets(section).map((summary) => createCandidate(input, "note", summary));
}

function extractLifecycleCandidates(input: PromotionInput): readonly PromotionCandidate[] {
  const requestNote = extractRequestNote(input);
  const bulletNotes = LIFECYCLE_BULLET_HEADERS.flatMap((header) => extractBulletNotes(input, header));
  if (requestNote === null) return bulletNotes;
  return [requestNote, ...bulletNotes];
}

function extractFallbackCandidate(input: PromotionInput): PromotionCandidate | null {
  const trimmed = input.markdown.trim();
  if (trimmed.length === 0) return null;
  const meaningful = firstMeaningfulLine(trimmed);
  if (meaningful.length === 0) return null;
  const summary = trimmed.slice(0, NOTE_SUMMARY_MAX_CHARS);
  return createCandidate(input, "note", summary);
}

export function extractCandidates(input: PromotionInput): PromotionExtraction {
  const structured = extractStructuredCandidates(input);
  if (structured.length > 0) return { candidates: structured };

  const lifecycle = extractLifecycleCandidates(input);
  if (lifecycle.length > 0) return { candidates: lifecycle };

  const fallback = extractFallbackCandidate(input);
  return { candidates: fallback === null ? [] : [fallback] };
}
