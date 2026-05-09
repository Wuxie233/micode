/**
 * Chinese-content guard for atlas nodes.
 *
 * Inspects atlas markdown prose for "Chinese-first" compliance. This is a hint
 * generator: it returns offenders for downstream tools (atlas-translator,
 * atlas-compiler) to surface; it never blocks writes itself. See R6 in plan.
 *
 * Machine syntax is intentionally exempt: frontmatter, fenced code, inline
 * code, wikilinks, file paths, and well-known tool/command names are stripped
 * before the CJK-ratio check.
 */

export const MIN_PROSE_LENGTH = 20;
export const CJK_RATIO_THRESHOLD = 0.3;

const CJK_REGEX = /[\u4E00-\u9FFF]/gu;
const FRONTMATTER_DELIM = "---";
const KNOWN_MACHINE_TOKENS = /\b(?:micode|OpenCode|plugin|agents?|hooks?|tools?|code)\b/gu;

export interface Offender {
  readonly lineNumber: number;
  readonly line: string;
  readonly cjkRatio: number;
}

export interface InspectResult {
  readonly ok: boolean;
  readonly offenders: readonly Offender[];
}

interface MarkdownScanState {
  readonly inFrontmatter: boolean;
  readonly inFence: boolean;
}

const stripMachineSyntax = (line: string): string =>
  line
    .replace(/\[\[[^\]]+\]\]/gu, "") // wikilinks
    .replace(/`[^`]+`/gu, "") // inline code
    .replace(/\b[a-zA-Z_][a-zA-Z0-9_./-]*\.[a-zA-Z]{1,5}\b/gu, "") // file paths
    .replace(/\/[a-z][a-z0-9-]*/gu, "") // slash commands
    .replace(/\b[a-z][a-z0-9_]*_[a-z0-9_]+\b/gu, "") // snake_case tool names
    .replace(KNOWN_MACHINE_TOKENS, "");

const cjkRatio = (text: string): number => {
  const stripped = text.replace(/\s+/gu, "");
  if (stripped.length === 0) return 1;
  const matches = stripped.match(CJK_REGEX);
  return (matches?.length ?? 0) / stripped.length;
};

const isProseLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("#")) return false;
  if (trimmed.startsWith("```")) return false;
  if (trimmed.startsWith(">")) return false;
  if (/^[-*+]\s/u.test(trimmed) === false && /^\d+\.\s/u.test(trimmed) === false && trimmed.startsWith("[["))
    return false;
  return true;
};

const updateFrontmatterState = (
  lineIndex: number,
  trimmed: string,
  state: MarkdownScanState,
): { readonly state: MarkdownScanState; readonly handled: boolean } => {
  if (lineIndex === 0 && trimmed === FRONTMATTER_DELIM)
    return { state: { ...state, inFrontmatter: true }, handled: true };
  if (!state.inFrontmatter) return { state, handled: false };
  return { state: { ...state, inFrontmatter: trimmed !== FRONTMATTER_DELIM }, handled: true };
};

const updateFenceState = (
  trimmed: string,
  state: MarkdownScanState,
): { readonly state: MarkdownScanState; readonly handled: boolean } => {
  if (!trimmed.startsWith("```")) return { state, handled: false };
  return { state: { ...state, inFence: !state.inFence }, handled: true };
};

const advanceMarkdownState = (
  lineIndex: number,
  trimmed: string,
  state: MarkdownScanState,
): { readonly state: MarkdownScanState; readonly skipLine: boolean } => {
  const frontmatter = updateFrontmatterState(lineIndex, trimmed, state);
  if (frontmatter.handled) return { state: frontmatter.state, skipLine: true };

  const fence = updateFenceState(trimmed, state);
  if (fence.handled) return { state: fence.state, skipLine: true };

  return { state, skipLine: state.inFence };
};

const inspectProseLine = (lineIndex: number, raw: string): Offender | undefined => {
  if (!isProseLine(raw)) return undefined;

  const stripped = stripMachineSyntax(raw.trim());
  if (stripped.length < MIN_PROSE_LENGTH) return undefined;

  const ratio = cjkRatio(stripped);
  return ratio < CJK_RATIO_THRESHOLD ? { lineNumber: lineIndex + 1, line: raw, cjkRatio: ratio } : undefined;
};

export function inspectAtlasNode(markdown: string): InspectResult {
  const lines = markdown.split("\n");
  let state: MarkdownScanState = { inFrontmatter: false, inFence: false };
  const offenders: Offender[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const advanced = advanceMarkdownState(i, trimmed, state);
    state = advanced.state;

    if (advanced.skipLine) continue;

    const offender = inspectProseLine(i, raw);
    if (offender) offenders.push(offender);
  }

  return { ok: offenders.length === 0, offenders };
}
